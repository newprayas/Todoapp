from flask import Flask, render_template, session, redirect, url_for, request, jsonify
from authlib.integrations.flask_client import OAuth
import os
import sqlite3
import click
from flask.cli import with_appcontext
from dotenv import load_dotenv

load_dotenv() # Load environment variables from .env file

app = Flask(__name__)
app.secret_key = os.urandom(24)

# Database setup
DATABASE = 'database.db'

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db


def ensure_was_overdue_column():
    db = get_db()
    cursor = db.cursor()
    # Check if column exists
    cols = cursor.execute("PRAGMA table_info('todos')").fetchall()
    col_names = [c['name'] for c in cols]
    if 'was_overdue' not in col_names:
        cursor.execute('ALTER TABLE todos ADD COLUMN was_overdue INTEGER NOT NULL DEFAULT 0')
        db.commit()
    if 'overdue_time' not in col_names:
        cursor.execute('ALTER TABLE todos ADD COLUMN overdue_time INTEGER NOT NULL DEFAULT 0')
        db.commit()
    db.close()

def init_db():
    db = get_db()
    with app.open_resource('schema.sql') as f:
        db.executescript(f.read().decode('utf8'))
    db.close()

@click.command('init-db')
@with_appcontext
def init_db_command():
    """Clear the existing data and create new tables."""
    init_db()
    click.echo('Initialized the database.')

app.cli.add_command(init_db_command)


# Safe limits for session increments (one day)
MAX_SESSION_SECONDS = 24 * 3600


@click.command('fix-focused-times')
@with_appcontext
def fix_focused_times():
    """Scan todos and fix obviously-bad focused_time / overdue_time values (e.g. milliseconds written as seconds).
    This converts values > 1_000_000 by dividing by 1000 and recomputes overdue flags.
    """
    db = get_db()
    cursor = db.cursor()
    rows = cursor.execute('SELECT id, focused_time, overdue_time FROM todos').fetchall()
    fixed = 0
    for r in rows:
        tid = r['id']
        ft = int(r['focused_time'] or 0)
        ot = int(r['overdue_time'] or 0)
        # Heuristic: very large values likely milliseconds
        if ft > 1000000:
            new_ft = ft // 1000
            new_ot = ot // 1000 if ot and ot > 1000000 else ot
            # recompute overdue based on duration
            meta = cursor.execute('SELECT duration_hours, duration_minutes FROM todos WHERE id = ?', (tid,)).fetchone()
            dh = int(meta['duration_hours'] or 0)
            dm = int(meta['duration_minutes'] or 0)
            total = (dh * 3600) + (dm * 60)
            was_overdue = 1 if total > 0 and new_ft > total else 0
            overdue_time = max(0, new_ft - total) if total > 0 else new_ot
            cursor.execute('UPDATE todos SET focused_time = ?, overdue_time = ?, was_overdue = ? WHERE id = ?', (new_ft, overdue_time, was_overdue, tid))
            fixed += 1
    db.commit()
    db.close()
    click.echo(f'Fixed {fixed} todos.')


app.cli.add_command(fix_focused_times)

# OAuth setup
oauth = OAuth(app)
google = oauth.register(
    name='google',
    client_id=os.environ.get('GOOGLE_CLIENT_ID'),
    client_secret=os.environ.get('GOOGLE_CLIENT_SECRET'),
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'},
)

@app.route('/')
def index():
    user = session.get('user')
    if user:
        ensure_was_overdue_column()
        db = get_db()
        todos = db.execute('SELECT * FROM todos WHERE user_id = ?', (user['sub'],)).fetchall()
        db.close()
        return render_template('index.html', user=user, todos=todos)
    return render_template('index.html', user=user)

@app.route('/login')
def login():
    redirect_uri = url_for('authorize', _external=True)
    return google.authorize_redirect(redirect_uri)

@app.route('/authorize')
def authorize():
    token = google.authorize_access_token()
    user_info = token['userinfo']
    session['user'] = user_info
    return redirect('/')

@app.route('/logout')
def logout():
    session.pop('user', None)
    return redirect('/')

@app.route('/add', methods=['POST'])
def add_todo():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    todo_text = data.get('text')
    duration_hours = data.get('duration_hours')
    duration_minutes = data.get('duration_minutes')

    if not todo_text or not duration_hours or not duration_minutes:
        return jsonify({'error': 'All fields are required'}), 400

    db = get_db()
    cursor = db.cursor()
    cursor.execute('INSERT INTO todos (user_id, text, duration_hours, duration_minutes, focused_time, was_overdue, overdue_time) VALUES (?, ?, ?, ?, 0, 0, 0)', 
                   (user['sub'], todo_text, duration_hours, duration_minutes))
    new_todo_id = cursor.lastrowid
    db.commit()
    db.close()

    return jsonify({'id': new_todo_id, 'text': todo_text, 'completed': 0, 'duration_hours': duration_hours, 'duration_minutes': duration_minutes, 'focused_time': 0, 'was_overdue': 0, 'overdue_time': 0})

@app.route('/delete', methods=['POST'])
def delete_todo():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    todo_id = data.get('id')

    db = get_db()
    db.execute('DELETE FROM todos WHERE id = ? AND user_id = ?', (todo_id, user['sub']))
    db.commit()
    db.close()

    return jsonify({'result': 'success'})

@app.route('/toggle', methods=['POST'])
def toggle_todo():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    todo_id = data.get('id')

    db = get_db()
    todo = db.execute('SELECT completed FROM todos WHERE id = ? AND user_id = ?', (todo_id, user['sub'])).fetchone()
    if todo:
        new_completed_status = not todo['completed']
        db.execute('UPDATE todos SET completed = ? WHERE id = ?', (new_completed_status, todo_id))
        db.commit()
    db.close()

    return jsonify({'result': 'success'})

@app.route('/update_focus_time', methods=['POST'])
def update_focus_time():
    user = session.get('user')
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json()
    todo_id = data.get('id')
    focused_time = data.get('focused_time')
    # normalize and clamp focused_time
    try:
        ft = int(focused_time or 0)
    except Exception:
        ft = 0
    # If value is unreasonably large, it might be milliseconds -> convert
    if ft > 1000000:
        ft = ft // 1000
    # clamp to a sane maximum (1 day)
    if ft > MAX_SESSION_SECONDS:
        ft = MAX_SESSION_SECONDS

    db = get_db()
    # update focused_time with normalized value
    db.execute('UPDATE todos SET focused_time = ? WHERE id = ? AND user_id = ?', (ft, todo_id, user['sub']))

    # compute was_overdue and overdue_time: compare focused_time with total duration
    row = db.execute('SELECT duration_hours, duration_minutes FROM todos WHERE id = ? AND user_id = ?', (todo_id, user['sub'])).fetchone()
    was_overdue = 0
    overdue_time = 0
    if row:
        duration_hours = row['duration_hours'] or 0
        duration_minutes = row['duration_minutes'] or 0
        total_seconds = (duration_hours * 3600) + (duration_minutes * 60)
        if total_seconds > 0 and ft > total_seconds:
            was_overdue = 1
            overdue_time = ft - total_seconds

    db.execute('UPDATE todos SET was_overdue = ?, overdue_time = ? WHERE id = ? AND user_id = ?', (was_overdue, overdue_time, todo_id, user['sub']))
    db.commit()
    db.close()

    # Return normalized focused_time so client can sync
    return jsonify({'result': 'success', 'was_overdue': was_overdue, 'overdue_time': overdue_time, 'focused_time': ft})

if __name__ == '__main__':
    app.run(debug=True)