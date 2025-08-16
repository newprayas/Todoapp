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
    const pomodoroCloseButton = document.getElementById('pomodoro-close-button');

    const borderFlashes = document.querySelectorAll('.border-flash');

    let timerInterval;
    let progressUpdateInterval;
    let timerState = 'paused';
    let currentMode = 'focus';
    let timeRemaining;
    let totalCycles;
    let currentCycle = 0;
    let currentTaskDuration = 0;
    let currentRunningTaskId = null;
    let focusSessionStartTime = 0;
    let lastFocusedTime = 0;

    // Add a new to-do item
    addButton.addEventListener('click', () => {
        const todoText = todoInput.value.trim();
        const durationHours = durationHoursInput.value.trim();
        const durationMinutes = durationMinutesInput.value.trim();

        if (todoText !== '' && durationHours !== '' && durationMinutes !== '') {
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
                if (data.error) {
                    alert(data.error);
                } else {
                    addTodoItemToDOM(data.id, data.text, data.completed, data.duration_hours, data.duration_minutes, data.focused_time);
                    todoInput.value = '';
                    durationHoursInput.value = '';
                    durationMinutesInput.value = '';
                    todoInput.focus();
                }
            });
        } else {
            alert('All fields are required');
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
                const durationHours = parseInt(li.dataset.durationHours) || 0;
                const durationMinutes = parseInt(li.dataset.durationMinutes) || 0;
                currentTaskDuration = (durationHours * 60) + durationMinutes;
                todoContainer.classList.add('pomodoro-active');
                pomodoroContainer.style.display = 'block';
                pomodoroTask.textContent = todoText;
                // keep the selected task id when resetting UI
                resetPomodoro();
                currentRunningTaskId = todoId;
                // initialize lastFocusedTime from stored dataset so realtime progress calc is correct
                lastFocusedTime = parseInt(li.dataset.focusedTime) || 0;
                updateProgressBar(todoId);
            } else if (target.closest('.done-button')) {
                // Toggle completion status
                const isCurrentlyCompleted = li.classList.contains('completed');
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
                        if (isCurrentlyCompleted) { // Task is being uncompleted
                            li.classList.remove('completed');
                            doneButtonIcon.classList.remove('fa-undo');
                            doneButtonIcon.classList.add('fa-check');
                            todoList.appendChild(li);
                        } else { // Task is being completed
                            li.classList.add('completed');
                            doneButtonIcon.classList.remove('fa-check');
                            doneButtonIcon.classList.add('fa-undo');
                            completedList.appendChild(li);

                            if (currentRunningTaskId === todoId) {
                                hidePomodoroTimer();
                            }
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
                        if (currentRunningTaskId === todoId) {
                            hidePomodoroTimer();
                        }
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
                currentCycle++;
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
            stopFocusTimer();
            currentMode = 'break';
            const breakDuration = parseInt(breakDurationInput.value);
            if(isNaN(breakDuration) || breakDuration <=0) {
                alert('Please enter a valid break duration.');
                return;
            }
            timeRemaining = breakDuration * 60;
            triggerFlashAnimation('green');
            startTimer();
        } else {
            currentMode = 'focus';
            const focusDuration = parseInt(focusDurationInput.value);
            if(isNaN(focusDuration) || focusDuration <=0) {
                alert('Please enter a valid focus duration.');
                return;
            }
            timeRemaining = focusDuration * 60;
            currentCycle++;
            updateSessionDisplay();
            triggerFlashAnimation('red');
            startTimer();
        }
    });

    pomodoroResetBtn.addEventListener('click', () => {
        resetTimer();
    });

    pomodoroCloseButton.addEventListener('click', () => {
        hidePomodoroTimer();
    });

    function startTimer() {
        timerState = 'running';
        pomodoroStartPauseBtn.textContent = 'Pause';

        document.querySelector('.pomodoro-inputs').style.display = 'none';

        if (currentMode === 'focus') {
            pomodoroSkipBtn.textContent = 'Skip to Break';
            pomodoroTimerWrapper.classList.remove('break-mode');
            pomodoroTimerWrapper.classList.add('focus-mode');
            startFocusTimer();
            
            // Clear any existing interval before starting a new one
            if (progressUpdateInterval) {
                clearInterval(progressUpdateInterval);
            }
            
            // Start progress bar update interval
            progressUpdateInterval = setInterval(() => {
                if (currentRunningTaskId && timerState === 'running') {
                    updateProgressBar(currentRunningTaskId);
                }
            }, 1000);
        } else {
            pomodoroSkipBtn.textContent = 'Skip to Focus';
            pomodoroTimerWrapper.classList.remove('focus-mode');
            pomodoroTimerWrapper.classList.add('break-mode');
        }

        timerInterval = setInterval(() => {
            timeRemaining--;
            if (timeRemaining <= 0) {
                clearInterval(timerInterval);
                timeRemaining = 0;
                updateTimerDisplay();
                handleSessionEnd();
            } else {
                updateTimerDisplay();
            }
        }, 1000);
    }

    function pauseTimer() {
        timerState = 'paused';
        clearInterval(timerInterval);
        clearInterval(progressUpdateInterval);
        stopFocusTimer();
        pomodoroStartPauseBtn.textContent = 'Resume';
    }

    function resetTimer() {
        clearInterval(timerInterval);
        stopFocusTimer();
        timerState = 'paused';
        const focusDuration = parseInt(focusDurationInput.value);
        if (!isNaN(focusDuration) && focusDuration > 0) {
            timeRemaining = focusDuration * 60;
        } else {
            timeRemaining = 25 * 60;
        }
        updateTimerDisplay();
        pomodoroStartPauseBtn.textContent = 'Start';
    }

    function resetPomodoro() {
        clearInterval(timerInterval);
        clearInterval(progressUpdateInterval);
        timerState = 'paused';
        currentMode = 'focus';
        timeRemaining = null;
        currentCycle = 0;
        pomodoroTimerDisplay.textContent = '25:00';
        pomodoroStartPauseBtn.textContent = 'Start';
        pomodoroNotification.style.display = 'none';
        pomodoroSessionDisplay.textContent = '';
        pomodoroTimerWrapper.classList.remove('focus-mode', 'break-mode');
        document.querySelector('.pomodoro-inputs').style.display = 'flex';
        focusDurationInput.value = '';
        breakDurationInput.value = '';
    cycleCountInput.value = '';
    }

    function hidePomodoroTimer() {
        if (timerState === 'running') {
            pauseTimer();
        }
        stopFocusTimer();
        resetPomodoro();
        pomodoroContainer.style.display = 'none';
        todoContainer.classList.remove('pomodoro-active');
        
        // Reset all state variables
        currentRunningTaskId = null;
        lastFocusedTime = 0;
        focusSessionStartTime = 0;
        clearInterval(progressUpdateInterval);
    }

    function updateTimerDisplay() {
        const displayTime = timeRemaining < 0 ? 0 : timeRemaining;
        const minutes = Math.floor(displayTime / 60);
        const seconds = displayTime % 60;
        pomodoroTimerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function updateSessionDisplay() {
        pomodoroSessionDisplay.textContent = `${currentCycle} / ${totalCycles}`;
    }

    function handleSessionEnd() {
        stopFocusTimer();
        if (currentMode === 'focus') {
            if (currentCycle < totalCycles) {
                currentMode = 'break';
                const breakDuration = parseInt(breakDurationInput.value);
                if(!isNaN(breakDuration) && breakDuration > 0) {
                    timeRemaining = breakDuration * 60;
                    showNotification('Focus session ended! Time for a break.', 'Start Break');
                } else {
                    resetPomodoro();
                }
            } else {
                showNotification('All cycles completed!', 'Reset Pomodoro');
            }
        } else {
            currentMode = 'focus';
            const focusDuration = parseInt(focusDurationInput.value);
            if(!isNaN(focusDuration) && focusDuration > 0) {
                timeRemaining = focusDuration * 60;
                showNotification('Break ended! Time to focus.', 'Start Focus');
            } else {
                resetPomodoro();
            }
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
            const newFlash = flash.cloneNode(true);
            flash.parentNode.replaceChild(newFlash, flash);

            newFlash.addEventListener('animationend', () => {
                newFlash.classList.remove('green-flash-active', 'red-flash-active');
            });
            newFlash.classList.add(`${color}-flash-active`);
        });
    }

    function addTodoItemToDOM(id, text, completed, durationHours, durationMinutes, focusedTime) {
        const li = document.createElement('li');
        li.dataset.id = id;
        li.dataset.durationHours = durationHours;
        li.dataset.durationMinutes = durationMinutes;
        li.dataset.focusedTime = focusedTime;

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

        const progressBarContainer = document.createElement('div');
        progressBarContainer.classList.add('progress-bar-container');
        const progressBar = document.createElement('div');
        progressBar.classList.add('progress-bar');
        progressBarContainer.appendChild(progressBar);
        li.appendChild(progressBarContainer);

        if (completed) {
            li.classList.add('completed');
            completedList.appendChild(li);
        } else {
            todoList.appendChild(li);
        }
        updateProgressBar(id);
    }

    function updateProgressBar(todoId) {
        const li = document.querySelector(`li[data-id='${todoId}']`);
        if (!li) return;

        const durationHours = parseInt(li.dataset.durationHours) || 0;
        const durationMinutes = parseInt(li.dataset.durationMinutes) || 0;
        const totalDurationInSeconds = (durationHours * 3600) + (durationMinutes * 60);
        
        // Calculate current focused time including the ongoing session
        let currentFocusedTime = lastFocusedTime;
        if (focusSessionStartTime > 0 && currentRunningTaskId === todoId && timerState === 'running') {
            const currentSessionTime = Math.floor((Date.now() - focusSessionStartTime) / 1000);
            currentFocusedTime += currentSessionTime;
        }

        const progressBar = li.querySelector('.progress-bar');
        if (totalDurationInSeconds > 0) {
            const progress = Math.min((currentFocusedTime / totalDurationInSeconds) * 100, 100);
            progressBar.style.width = `${progress}%`;
        } else {
            progressBar.style.width = '0%';
        }
    }

    function startFocusTimer() {
        focusSessionStartTime = Date.now();
        const li = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
        if (li) {
            lastFocusedTime = parseInt(li.dataset.focusedTime) || 0;
        }
    }

    function stopFocusTimer() {
        if (focusSessionStartTime === 0) return;

        const elapsedSeconds = Math.floor((Date.now() - focusSessionStartTime) / 1000);
        const li = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
        if (li) {
            const newFocusedTime = lastFocusedTime + elapsedSeconds;
            li.dataset.focusedTime = newFocusedTime;
            updateFocusTimeOnServer(currentRunningTaskId, newFocusedTime);
            lastFocusedTime = newFocusedTime;
            updateProgressBar(currentRunningTaskId);
        }
        focusSessionStartTime = 0;
    }

    function updateFocusTimeOnServer(todoId, focusedTime) {
        fetch('/update_focus_time', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ id: todoId, focused_time: focusedTime }),
        });
    }

    // Initial progress bar update
    document.querySelectorAll('#todo-list li, #completed-list li').forEach(li => {
        updateProgressBar(li.dataset.id);
    });
});