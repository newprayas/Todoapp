document.addEventListener('DOMContentLoaded', () => {
    const todoInput = document.getElementById('todo-input');
    const addButton = document.getElementById('add-button');
    const todoList = document.getElementById('todo-list');
    const completedList = document.getElementById('completed-list');
    const durationHoursInput = document.getElementById('duration-hours');
    const durationMinutesInput = document.getElementById('duration-minutes');

    const todoContainer = document.querySelector('.todo-container');
    const pomodoroContainer = document.querySelector('.pomodoro-container');
    const pomodoroTask = document.getElementById('pomodoro-task');
    const pomodoroSessionDisplay = document.getElementById('pomodoro-session-display');
    const focusDurationInput = document.getElementById('focus-duration');
    const breakDurationInput = document.getElementById('break-duration');
    const cycleCountInput = document.getElementById('cycle-count');
    const pomodoroTimerDisplay = document.querySelector('.pomodoro-timer');
    const pomodoroTimerWrapper = document.querySelector('.pomodoro-timer-wrapper');
    const pomodoroStartPauseBtn = document.getElementById('pomodoro-start-pause');
    const pomodoroSkipBtn = document.getElementById('pomodoro-skip');
    const pomodoroResetBtn = document.getElementById('pomodoro-reset');
    const pomodoroNotification = document.getElementById('pomodoro-notification');

    const borderFlashes = document.querySelectorAll('.border-flash');

    let timerInterval;
    let timerState = 'paused';
    let currentMode = 'focus';
    let timeRemaining;
    let totalCycles;
    let currentCycle = 0;
    let currentTaskDuration = 0;

    // Add a new to-do item
    addButton.addEventListener('click', () => {
        const todoText = todoInput.value.trim();
        const durationHours = durationHoursInput.value.trim();
        const durationMinutes = durationMinutesInput.value.trim();

        if (todoText !== '') {
            fetch('/add', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    text: todoText,
                    duration_hours: durationHours,
                    duration_minutes: durationMinutes
                }),
            })
            .then(response => response.json())
            .then(data => {
                if (!data.error) {
                    addTodoItemToDOM(data.id, data.text, data.completed, data.duration_hours, data.duration_minutes);
                    todoInput.value = '';
                    durationHoursInput.value = '';
                    durationMinutesInput.value = '';
                    todoInput.focus();
                }
            });
        }
    });

    todoInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addButton.click();
        }
    });

    // Event listener for all lists
    [todoList, completedList].forEach(list => {
        list.addEventListener('click', (e) => {
            const target = e.target;
            const li = target.closest('li');
            if (!li) return;

            const todoId = li.dataset.id;
            const todoText = li.querySelector('span').textContent;

            if (target.closest('.play-button')) {
                console.log('Play button clicked!');
                // Show Pomodoro timer
                const durationHours = parseInt(li.dataset.durationHours) || 0;
                const durationMinutes = parseInt(li.dataset.durationMinutes) || 0;
                currentTaskDuration = (durationHours * 60) + durationMinutes;

                todoContainer.classList.add('pomodoro-active');
                pomodoroContainer.style.display = 'block';
                pomodoroTask.textContent = todoText;
                resetPomodoro();
                console.log('Classes and display set.');
            } else if (target.closest('.done-button')) {
                // Toggle completion status
                fetch('/toggle', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id: todoId }),
                })
                .then(response => response.json())
                .then(data => {
                    if (data.result === 'success') {
                        const doneButtonIcon = li.querySelector('.done-button i');
                        if (li.classList.contains('completed')) {
                            li.classList.remove('completed');
                            doneButtonIcon.classList.remove('fa-undo');
                            doneButtonIcon.classList.add('fa-check');
                            todoList.appendChild(li);
                        } else {
                            li.classList.add('completed');
                            doneButtonIcon.classList.remove('fa-check');
                            doneButtonIcon.classList.add('fa-undo');
                            completedList.appendChild(li);
                        }
                    }
                });
            } else if (target.closest('.delete-button')) {
                // Delete to-do item
                fetch('/delete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ id: todoId }),
                })
                .then(response => response.json())
                .then(data => {
                    if (data.result === 'success') {
                        li.remove();
                    }
                });
            }
        });
    });

    // Pomodoro Timer Logic
    focusDurationInput.addEventListener('input', () => {
        const focusDuration = parseInt(focusDurationInput.value);
        if (!isNaN(focusDuration) && focusDuration > 0 && currentTaskDuration > 0) {
            const calculatedCycles = Math.floor(currentTaskDuration / focusDuration);
            cycleCountInput.value = calculatedCycles > 0 ? calculatedCycles : 1;
        }
    });

    pomodoroStartPauseBtn.addEventListener('click', () => {
        if (timerState === 'paused') {
            const focusDuration = parseInt(focusDurationInput.value);
            const breakDuration = parseInt(breakDurationInput.value);
            totalCycles = parseInt(cycleCountInput.value);

            if (isNaN(focusDuration) || isNaN(breakDuration) || isNaN(totalCycles) || focusDuration <= 0 || breakDuration <= 0 || totalCycles <= 0) {
                alert('Please enter valid values for focus, break, and cycles.');
                return;
            }

            if (!timeRemaining) {
                timeRemaining = focusDuration * 60;
                currentCycle++; // Increment only for new focus sessions
                updateSessionDisplay();
            }
            startTimer();
        } else {
            pauseTimer();
        }
    });

    pomodoroSkipBtn.addEventListener('click', () => {
        clearInterval(timerInterval);
        if (currentMode === 'focus') {
            currentMode = 'break';
            timeRemaining = parseInt(breakDurationInput.value) * 60;
            triggerFlashAnimation('green');
            startTimer();
        } else {
            currentMode = 'focus';
            timeRemaining = parseInt(focusDurationInput.value) * 60;
            currentCycle++; // Increment cycle when skipping from break to focus
            updateSessionDisplay();
            triggerFlashAnimation('red');
            startTimer();
        }
    });

    pomodoroResetBtn.addEventListener('click', () => {
        resetTimer();
    });

    function startTimer() {
        timerState = 'running';
        pomodoroStartPauseBtn.textContent = 'Pause';

        // Hide input fields
        document.querySelector('.pomodoro-inputs').style.display = 'none';

        if (currentMode === 'focus') {
            pomodoroSkipBtn.textContent = 'Skip to Break';
            pomodoroTimerWrapper.classList.remove('break-mode');
            pomodoroTimerWrapper.classList.add('focus-mode');
        } else {
            pomodoroSkipBtn.textContent = 'Skip to Focus';
            pomodoroTimerWrapper.classList.remove('focus-mode');
            pomodoroTimerWrapper.classList.add('break-mode');
        }

        timerInterval = setInterval(() => {
            timeRemaining--;
            updateTimerDisplay();

            if (timeRemaining < 0) {
                clearInterval(timerInterval);
                handleSessionEnd();
            }
        }, 1000);
    }

    function pauseTimer() {
        timerState = 'paused';
        clearInterval(timerInterval);
        pomodoroStartPauseBtn.textContent = 'Resume';
    }

    function resetTimer() {
        clearInterval(timerInterval);
        timerState = 'paused';
        if (currentMode === 'focus') {
            timeRemaining = parseInt(focusDurationInput.value) * 60;
        } else {
            timeRemaining = parseInt(breakDurationInput.value) * 60;
        }
        updateTimerDisplay();
        pomodoroStartPauseBtn.textContent = 'Start';
    }

    function resetPomodoro() {
        clearInterval(timerInterval);
        timerState = 'paused';
        currentMode = 'focus';
        timeRemaining = null;
        currentCycle = 0;
        pomodoroTimerDisplay.textContent = '25:00';
        pomodoroStartPauseBtn.textContent = 'Start';
        pomodoroNotification.style.display = 'none';
        pomodoroSessionDisplay.textContent = '';
        pomodoroTimerWrapper.classList.remove('focus-mode', 'break-mode');
        document.querySelector('.pomodoro-inputs').style.display = 'flex'; // Show input fields
        focusDurationInput.value = '';
        breakDurationInput.value = '';
        cycleCountInput.value = '';
    }

    function updateTimerDisplay() {
        const minutes = Math.floor(timeRemaining / 60);
        const seconds = timeRemaining % 60;
        pomodoroTimerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function updateSessionDisplay() {
        pomodoroSessionDisplay.textContent = `${currentCycle} / ${totalCycles}`;
    }

    function handleSessionEnd() {
        if (currentMode === 'focus') {
            if (currentCycle < totalCycles) {
                currentMode = 'break';
                timeRemaining = parseInt(breakDurationInput.value) * 60;
                showNotification('Focus session ended! Time for a break.', 'Start Break');
            } else {
                showNotification('All cycles completed!', 'Reset Pomodoro');
            }
        } else {
            currentMode = 'focus';
            timeRemaining = parseInt(focusDurationInput.value) * 60;
            showNotification('Break ended! Time to focus.', 'Start Focus');
        }
    }

    function showNotification(message, buttonText) {
        pomodoroNotification.textContent = message;
        const nextSessionBtn = document.createElement('button');
        nextSessionBtn.textContent = buttonText;
        nextSessionBtn.addEventListener('click', () => {
            pomodoroNotification.style.display = 'none';
            if (buttonText === 'Reset Pomodoro') {
                resetPomodoro();
            } else {
                startTimer();
            }
        });
        pomodoroNotification.appendChild(nextSessionBtn);
        pomodoroNotification.style.display = 'block';
    }

    function triggerFlashAnimation(color) {
        borderFlashes.forEach(flash => {
            flash.classList.remove('green-flash-active', 'red-flash-active');
            flash.classList.add(`${color}-flash-active`);
        });
        setTimeout(() => {
            borderFlashes.forEach(flash => {
                flash.classList.remove('green-flash-active', 'red-flash-active');
            });
        }, 1000); // Match animation duration
    }

    function addTodoItemToDOM(id, text, completed, durationHours, durationMinutes) {
        const li = document.createElement('li');
        li.dataset.id = id;
        li.dataset.durationHours = durationHours;
        li.dataset.durationMinutes = durationMinutes;

        const span = document.createElement('span');
        span.textContent = text;

        const actionsDiv = document.createElement('div');
        actionsDiv.classList.add('actions');

        const durationStr = [];
        if (durationHours && durationHours > 0) {
            durationStr.push(`${durationHours}h`);
        }
        if (durationMinutes && durationMinutes > 0) {
            durationStr.push(`${durationMinutes}m`);
        }

        if (durationStr.length > 0) {
            const durationSpan = document.createElement('span');
            durationSpan.classList.add('duration');
            durationSpan.textContent = durationStr.join(' ');
            actionsDiv.appendChild(durationSpan);
        }

        const playButton = document.createElement('button');
        playButton.classList.add('play-button');
        playButton.innerHTML = '<i class="fas fa-play"></i>';

        const doneButton = document.createElement('button');
        doneButton.classList.add('done-button');
        doneButton.innerHTML = completed ? '<i class="fas fa-undo"></i>' : '<i class="fas fa-check"></i>';

        const deleteButton = document.createElement('button');
        deleteButton.classList.add('delete-button');
        deleteButton.innerHTML = '<i class="fas fa-trash"></i>';

        actionsDiv.appendChild(playButton);
        actionsDiv.appendChild(doneButton);
        actionsDiv.appendChild(deleteButton);

        li.appendChild(span);
        li.appendChild(actionsDiv);

        if (completed) {
            li.classList.add('completed');
            completedList.appendChild(li);
        } else {
            todoList.appendChild(li);
        }
    }
});