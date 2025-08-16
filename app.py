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
    cursor.execute('INSERT INTO todos (user_id, text, duration_hours, duration_minutes) VALUES (?, ?, ?, ?)', 
                   (user['sub'], todo_text, duration_hours, duration_minutes))
    new_todo_id = cursor.lastrowid
    db.commit()
    db.close()

    return jsonify({'id': new_todo_id, 'text': todo_text, 'completed': 0, 'duration_hours': duration_hours, 'duration_minutes': duration_minutes, 'focused_time': 0})

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

    db = get_db()
    db.execute('UPDATE todos SET focused_time = ? WHERE id = ? AND user_id = ?', (focused_time, todo_id, user['sub']))
    db.commit()
    db.close()

    return jsonify({'result': 'success'})

if __name__ == '__main__':
    app.run(debug=True)