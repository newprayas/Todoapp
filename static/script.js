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
    let globalProgressCheckerInterval = null;

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
                    addTodoItemToDOM(data.id, data.text, data.completed, data.duration_hours, data.duration_minutes, data.focused_time, data.was_overdue, data.overdue_time);
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
                // If another task currently has an active focus session, persist and pause it
                // so its progress is not lost when switching to a different task.
                if (currentRunningTaskId && currentRunningTaskId !== todoId) {
                    // If a timer is running (could be focus or break), pause intervals
                    if (timerState === 'running') {
                        pauseTimer();
                    }
                    // If there was an active focus session, stop it and persist elapsed time
                    if (focusSessionStartTime > 0) {
                        stopFocusTimer();
                    }
                }
                // keep the selected task id when resetting UI
                // remove visual highlight from previous task
                const prevActive = document.querySelector('li.active-task');
                if (prevActive && prevActive.dataset.id && prevActive.dataset.id !== todoId) {
                    prevActive.classList.remove('active-task');
                }

                // keep the selected task id when resetting UI
                resetPomodoro();
                currentRunningTaskId = todoId;
                // highlight the selected task in the list for visibility
                li.classList.add('active-task');
                // ensure default focus/break values (user can change them)
                if (!focusDurationInput.value) focusDurationInput.value = 25;
                if (!breakDurationInput.value) breakDurationInput.value = 5;
                // initialize lastFocusedTime from stored dataset so realtime progress calc is correct
                lastFocusedTime = parseInt(li.dataset.focusedTime) || 0;
                // Render the task name inside the Pomodoro panel with bordered styling
                // If the task is overdue, append a red-dot emoji inline to the name
                const wasOverdue = li.dataset.wasOverdue || li.getAttribute('data-was-overdue');
                const overdueEmoji = (wasOverdue && parseInt(wasOverdue) === 1) ? ' <span class="pomodoro-overdue-emoji">🔴</span>' : '';
                pomodoroTask.innerHTML = `<span class="pomodoro-task-name">${todoText}${overdueEmoji}</span>`;
                // hide the separate overdue hint element (we now show emoji inline)
                const hint = document.getElementById('pomodoro-overdue-hint');
                if (hint) hint.style.display = 'none';
                // Auto-calc cycles if cycles input is empty (applies also for restored overdue tasks)
                updateProgressBar(todoId);
                const focusDurationRaw = parseInt(focusDurationInput.value);
                const focusDuration = (!isNaN(focusDurationRaw) && focusDurationRaw > 0) ? focusDurationRaw : 25;
                if (currentTaskDuration > 0) {
                    // Only auto-calc when user hasn't provided a cycles value
                    if (!cycleCountInput.value || parseInt(cycleCountInput.value) <= 0) {
                        const calculatedCycles = Math.max(1, Math.floor(currentTaskDuration / focusDuration));
                        cycleCountInput.value = calculatedCycles;
                    }
                }
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
                            // If there is an overdue badge, remove it from title and restore card styling
                            const badge = li.querySelector('.overdue-badge');
                            if (badge) badge.remove();
                            // If there was a completed-overdue text indicator, remove it so it doesn't duplicate with active progress bar
                            const compOverEl = li.querySelector('.completed-overdue-text');
                            if (compOverEl) compOverEl.remove();
                            if (li.dataset.wasOverdue == 1 || li.getAttribute('data-was-overdue') == '1') {
                                // restore visual overdue state on the card if still overdue
                                li.classList.add('overdue');
                            }
                            todoList.appendChild(li);
                        } else { // Task is being completed
                            // If task was overdue, move visual indicator from card to a small badge next to title
                            const wasOverdue = li.dataset.wasOverdue || li.getAttribute('data-was-overdue');
                            if (wasOverdue && parseInt(wasOverdue) === 1) {
                                // remove red card styling
                                li.classList.remove('overdue');
                                // add red-circle badge emoji
                                addOverdueBadge(li);
                            }

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
    // Debug: trace skip click
    console.log('DEBUG: Skip clicked - currentMode:', currentMode, 'timerState:', timerState, 'currentRunningTaskId:', currentRunningTaskId);

    // Clear running intervals to prepare for mode switch
    clearInterval(timerInterval);
    clearInterval(progressUpdateInterval);

        // Safe defaults
        const DEFAULT_FOCUS_MIN = 25;
        const DEFAULT_BREAK_MIN = 5;

        if (currentMode === 'focus') {
            // Leaving a focus session -> stop tracking and go to break
            stopFocusTimer();
            console.log('DEBUG: switching from focus to break');
            currentMode = 'break';
            let breakDuration = parseInt(breakDurationInput.value);
            if (isNaN(breakDuration) || breakDuration <= 0) {
                breakDuration = DEFAULT_BREAK_MIN;
            }
            timeRemaining = breakDuration * 60;
            console.log('DEBUG: breakDuration (mins):', breakDuration, 'timeRemaining (s):', timeRemaining);
            triggerFlashAnimation('green');
            // start timer in break mode
            startTimer();
        } else {
            // Leaving a break -> go to focus
            currentMode = 'focus';
            console.log('DEBUG: switching from break to focus');
            let focusDuration = parseInt(focusDurationInput.value);
            if (isNaN(focusDuration) || focusDuration <= 0) {
                focusDuration = DEFAULT_FOCUS_MIN;
            }
            timeRemaining = focusDuration * 60;
            // increment cycle since user is starting a new focus session
            currentCycle++;
            updateSessionDisplay();
            console.log('DEBUG: focusDuration (mins):', focusDuration, 'timeRemaining (s):', timeRemaining, 'currentCycle:', currentCycle);
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
        // Visually mark the currently running task in the list
        if (currentRunningTaskId) {
            const runningLi = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
            if (runningLi) runningLi.classList.add('active-task');
        }
    console.log('DEBUG: startTimer called - mode:', currentMode, 'timeRemaining:', timeRemaining, 'currentRunningTaskId:', currentRunningTaskId, 'progressUpdateInterval id:', progressUpdateInterval);

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
            if (progressUpdateInterval) {
                console.log('DEBUG: clearing existing progressUpdateInterval before creating new one, id=', progressUpdateInterval);
                clearInterval(progressUpdateInterval);
            }
            progressUpdateInterval = setInterval(() => {
                if (currentRunningTaskId && timerState === 'running') {
                    updateProgressBar(currentRunningTaskId);
                }
            }, 1000);
            console.log('DEBUG: progressUpdateInterval set to', progressUpdateInterval);
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
    console.log('DEBUG: pauseTimer called - timeRemaining:', timeRemaining, 'currentMode:', currentMode, 'progressUpdateInterval id:', progressUpdateInterval);
    timerState = 'paused';
        clearInterval(timerInterval);
        if (progressUpdateInterval) {
            clearInterval(progressUpdateInterval);
            console.log('DEBUG: cleared progressUpdateInterval', progressUpdateInterval);
            progressUpdateInterval = null;
        }
        stopFocusTimer();
        // Remove visual highlight when paused
        if (currentRunningTaskId) {
            const runningLi = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
            if (runningLi) runningLi.classList.remove('active-task');
        }
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
    // Clear displayed task name and overdue hint
    pomodoroTask.innerHTML = '';
    const hint = document.getElementById('pomodoro-overdue-hint');
    if (hint) hint.style.display = 'none';
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
    // remove highlight from any active task
    const runningLi = document.querySelector('li.active-task');
    if (runningLi) runningLi.classList.remove('active-task');
    currentRunningTaskId = null;
        lastFocusedTime = 0;
        focusSessionStartTime = 0;
        if (progressUpdateInterval) {
            clearInterval(progressUpdateInterval);
            console.log('DEBUG: hidePomodoroTimer cleared progressUpdateInterval', progressUpdateInterval);
            progressUpdateInterval = null;
        }
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
        // Query fresh elements each time to avoid working with detached nodes
        const flashes = document.querySelectorAll('.border-flash');
        console.log('DEBUG: triggerFlashAnimation - color:', color, 'borderFlashes count:', flashes.length);
        flashes.forEach(flash => {
            // Remove any running animation classes
            flash.classList.remove('green-flash-active', 'red-flash-active');
            // Force reflow to restart animation
            // eslint-disable-next-line no-unused-expressions
            void flash.offsetWidth;
            // Add desired animation class
            flash.classList.add(`${color}-flash-active`);
            // Clean up after animation ends
            flash.addEventListener('animationend', function handler() {
                flash.classList.remove('green-flash-active', 'red-flash-active');
                flash.removeEventListener('animationend', handler);
            });
        });
    }

    function addTodoItemToDOM(id, text, completed, durationHours, durationMinutes, focusedTime, wasOverdue, overdueTime) {
    const li = document.createElement('li');
        li.dataset.id = id;
        li.dataset.durationHours = durationHours;
        li.dataset.durationMinutes = durationMinutes;
        li.dataset.focusedTime = focusedTime;
        li.dataset.overdueTime = overdueTime || 0;
        // store persisted overdue flag
        li.dataset.wasOverdue = wasOverdue || 0;

    // Create a left column wrapper that holds the title and any small metadata lines (like overdue text)
    const taskLeft = document.createElement('div');
    taskLeft.classList.add('task-left');

    const span = document.createElement('span');
    span.textContent = text;
    taskLeft.appendChild(span);

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

    // append the left column first, then the actions (which stays aligned right by flex)
    li.appendChild(taskLeft);
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
            // If this completed task had overdue time persisted, show the small overdue indicator under the title
            if (parseInt(li.dataset.overdueTime) > 0 || parseInt(li.dataset.wasOverdue) === 1) {
                ensureCompletedOverdueIndicator(li);
            }
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
        
        // Base focused time comes from the stored dataset for this task
        let currentFocusedTime = parseInt(li.dataset.focusedTime) || 0;
        // If this task is currently being focused, add the ongoing session time
        if (focusSessionStartTime > 0 && currentRunningTaskId === todoId && timerState === 'running') {
            const currentSessionTime = Math.floor((Date.now() - focusSessionStartTime) / 1000);
            currentFocusedTime += currentSessionTime;
        }

    const progressBar = li.querySelector('.progress-bar');
    const progressContainer = li.querySelector('.progress-bar-container');
        if (totalDurationInSeconds > 0) {
            const progress = Math.min((currentFocusedTime / totalDurationInSeconds) * 100, 100);
            progressBar.style.width = `${progress}%`;
            // Mark the task as overdue (red card) when fully completed but not toggled as done
                if (progress >= 100 && !li.classList.contains('completed')) {
                li.classList.add('overdue');

                // Show the global overdue modal once when crossing the planned duration
                if (!li.dataset.overdueNotified) {
                    console.log('DEBUG: progress reached 100% - prompting user for todo', todoId);
                    // mark notified immediately to avoid duplicate prompts
                    li.dataset.overdueNotified = 1;
                    // set an overdue baseline if not present so extra time counts only after planned duration
                    if (!li.dataset.overdueBaseline) {
                        li.dataset.overdueBaseline = totalDurationInSeconds;
                    }
                    // If this task is currently running in focus mode, hide the Pomodoro UI so the timer
                    // is paused and the panel is collapsed immediately before showing the modal.
                    if (focusSessionStartTime > 0 && currentRunningTaskId === todoId && timerState === 'running' && currentMode === 'focus') {
                        // hidePomodoroTimer will pause, stop the focus timer, and reset the Pomodoro UI
                        hidePomodoroTimer();
                    }
                    // show modal prompt regardless of Pomodoro visibility
                    showOverduePrompt(todoId, 'Planned time reached — mark complete or continue working on overdue task?');
                }
            } else {
                li.classList.remove('overdue');
                // reset notified flag if user goes back below threshold
                if (li.dataset.overdueNotified) {
                    delete li.dataset.overdueNotified;
                }
            }
        } else {
            progressBar.style.width = '0%';
        }
        // Show extra overdue time (time worked after planned duration)
    // Show overdue extra only for time actually spent in Pomodoro focus sessions plus any persisted overdue_time
    const persistedOverdue = parseInt(li.dataset.overdueTime) || 0;
    const baseline = parseInt(li.dataset.overdueBaseline) || totalDurationInSeconds;
    let sessionOverdue = 0;
    // Only count session overdue when this task is actively being focused via Pomodoro
    if (focusSessionStartTime > 0 && currentRunningTaskId === todoId && timerState === 'running' && currentMode === 'focus') {
        const currentSessionTime = Math.floor((Date.now() - focusSessionStartTime) / 1000);
        const persistedFocused = parseInt(li.dataset.focusedTime) || 0;
        const totalFocusedNow = persistedFocused + currentSessionTime;
        // sessionOverdue should represent ONLY the portion of overtime accumulated in THIS active session
        // i.e. totalFocusedNow - baseline minus any persisted overdue already recorded on the server
        const alreadyPersistedOverdue = persistedOverdue;
        if (totalFocusedNow > baseline) {
            sessionOverdue = Math.max(0, (totalFocusedNow - baseline) - alreadyPersistedOverdue);
        }
    }

    const extraSeconds = persistedOverdue + sessionOverdue;
    let extraEl = li.querySelector('.overdue-extra');
    // Ensure a single persistent element per li to avoid DOM thrash when multiple timers call update
    if (!extraEl) {
        extraEl = document.createElement('div');
        extraEl.classList.add('overdue-extra');
        extraEl.style.display = 'none';
        if (progressContainer) progressContainer.parentNode.insertBefore(extraEl, progressContainer.nextSibling);
        else li.appendChild(extraEl);
    }

    // cancel any pending hide timer
    if (li._overdueHideTimer) {
        clearTimeout(li._overdueHideTimer);
        li._overdueHideTimer = null;
    }

    console.log('DEBUG: overdue calc for', todoId, 'persistedOverdue:', persistedOverdue, 'sessionOverdue:', sessionOverdue, 'extraSeconds:', extraSeconds);
    if (extraSeconds > 0 && !li.classList.contains('completed')) {
        extraEl.textContent = `Overdue time: ${formatDuration(extraSeconds)}`;
        extraEl.style.display = 'block';
    } else {
        // debounce hiding to avoid flicker when updateProgressBar is called rapidly from multiple intervals
        li._overdueHideTimer = setTimeout(() => {
            if (extraEl) extraEl.style.display = 'none';
            li._overdueHideTimer = null;
        }, 700);
    }
    }

    function formatDuration(seconds) {
        seconds = Math.floor(seconds);
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hrs > 0) {
            if (mins > 0) return `${hrs}h ${mins}m`;
            return `${hrs}h`;
        }
        if (mins > 0) {
            if (secs > 0) return `${mins}m ${secs}s`;
            return `${mins}m`;
        }
        return `${secs}s`;
    }

    // showOverduePrompt can be called as showOverduePrompt(todoId, message)
    function showOverduePrompt(message) {
        // message param may be overloaded; handle signature showOverduePrompt(todoId, message)
        let todoId = null;
        let text = message;
        if (typeof message === 'string' && arguments.length === 2) {
            // called as showOverduePrompt(todoId, message)
        }
        if (arguments.length === 2) {
            todoId = arguments[0];
            text = arguments[1];
        }
        // We'll use the global modal so prompt appears regardless of Pomodoro visibility
        const modal = document.getElementById('global-overdue-modal');
        const messageEl = document.getElementById('global-overdue-message');

        // small helper to escape HTML when injecting task names
        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
        }
        const markBtn = document.getElementById('modal-mark-complete');
        const contBtn = document.getElementById('modal-continue');

        // Build a clearer message that shows the task name highlighted and a second line with the action
        let taskName = '';
        if (todoId) {
            const li = document.querySelector(`li[data-id='${todoId}']`);
            if (li) taskName = li.querySelector('span') ? li.querySelector('span').textContent : '';
        }

        // Only show the modal once per task reaching overdue: use localStorage key 'overdueModalShown:<id>'
        const storageKey = todoId ? `overdueModalShown:${todoId}` : null;
        if (storageKey && localStorage.getItem(storageKey)) {
            // Already shown before for this task — don't show again
            return;
        }

        // Use a structured message regardless of the `text` param for clarity
        messageEl.innerHTML = `
            <div class="modal-message-main"><span class="modal-task-name">${escapeHtml(taskName)}</span> planned time is completed</div>
            <div style="margin-top:8px; font-size:0.95em;">Mark complete OR continue working on overdue task?</div>
        `;
        modal.style.display = 'flex';
        // Unbind previous handlers by cloning
        const markClone = markBtn.cloneNode(true);
        markBtn.parentNode.replaceChild(markClone, markBtn);
        const contClone = contBtn.cloneNode(true);
        contBtn.parentNode.replaceChild(contClone, contBtn);

        // Re-acquire refs
        const mark = document.getElementById('modal-mark-complete');
        const cont = document.getElementById('modal-continue');

    mark.addEventListener('click', () => {
            modal.style.display = 'none';
            if (!todoId) return;
            // mark modal as shown for this task so it won't reappear on refresh or restore
            try { if (todoId) localStorage.setItem(`overdueModalShown:${todoId}`, '1'); } catch(e) {}
            fetch('/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: todoId }),
            })
                        .then(res => res.json())
                    .then(data => {
                        const li = document.querySelector(`li[data-id='${todoId}']`);
                        if (li) {
                            const doneIcon = li.querySelector('.done-button i');
                            // remove any overdue visual styling from completed tasks
                            li.classList.remove('overdue');
                            li.classList.add('completed');
                            if (doneIcon) { doneIcon.classList.remove('fa-check'); doneIcon.classList.add('fa-undo'); }
                            completedList.appendChild(li);
                            const wasOverdue = li.dataset.wasOverdue || li.getAttribute('data-was-overdue');
                            if (wasOverdue && parseInt(wasOverdue) === 1) {
                                addOverdueBadge(li);
                                // Move any displayed overdue-extra (live overdue time) to the completed-overdue-text
                                // so it appears on a new line under the title immediately.
                                const extra = li.querySelector('.overdue-extra');
                                if (extra) {
                                    // create/replace completed-overdue-text with the same content
                                    const prev = li.querySelector('.completed-overdue-text');
                                    if (prev) prev.remove();
                                    const text = document.createElement('div');
                                    text.classList.add('completed-overdue-text');
                                    text.textContent = extra.textContent.replace('Overdue time:', 'Overdue:');
                                    const span = li.querySelector('.task-left') ? li.querySelector('.task-left') : li.querySelector('span');
                                    if (span) span.parentNode.insertBefore(text, span.nextSibling);
                                    // remove live extra to avoid duplication
                                    extra.remove();
                                } else {
                                    ensureCompletedOverdueIndicator(li);
                                }
                            }
                            // clear the notified flag, baseline and any continue flag
                            if (li.dataset.overdueNotified) delete li.dataset.overdueNotified;
                            if (li.dataset.overdueBaseline) delete li.dataset.overdueBaseline;
                            if (li.dataset.overdueInContinue) delete li.dataset.overdueInContinue;
                            hidePomodoroTimer();
                        }
                    });
        });

        cont.addEventListener('click', () => {
            modal.style.display = 'none';
            // mark modal as shown so it won't reappear on refresh
            try { if (todoId) localStorage.setItem(`overdueModalShown:${todoId}`, '1'); } catch(e) {}
            const li = document.querySelector(`li[data-id='${todoId}']`);
            if (li && !li.dataset.overdueBaseline) {
                const dh = parseInt(li.dataset.durationHours) || 0;
                const dm = parseInt(li.dataset.durationMinutes) || 0;
                li.dataset.overdueBaseline = (dh * 3600) + (dm * 60);
            }
            // mark that the user chose to continue working if they later start a Pomodoro
            if (li) li.dataset.overdueInContinue = 1;
            // Do NOT start timers here. The actual focus session should begin only when the user
            // opens the Pomodoro and presses Start for this task (or presses the Play button on the task).
            // Leaving timers stopped avoids the overdue counter incrementing before the user actively starts.
        });
    }

    function addOverdueBadge(li) {
        if (!li) return;
        // ensure no duplicate badge
        let badge = li.querySelector('.overdue-badge');
        if (!badge) {
            const span = li.querySelector('span');
            badge = document.createElement('span');
            badge.classList.add('overdue-badge');
            badge.textContent = '🔴';
            badge.title = 'This task was completed overdue';
            span.appendChild(badge);
        }
    }

    // For completed tasks, add a subtle overdue indicator (text) beneath the task name
    function ensureCompletedOverdueIndicator(li) {
        if (!li) return;
        // remove any overdue class that may add a red border
        li.classList.remove('overdue');
        // remove previous indicator to avoid duplicates
        const prev = li.querySelector('.completed-overdue-text');
        if (prev) prev.remove();

        const overdueSeconds = parseInt(li.dataset.overdueTime) || 0;
        if (overdueSeconds > 0) {
            const text = document.createElement('div');
            text.classList.add('completed-overdue-text');
            text.textContent = `Overdue: ${formatDuration(overdueSeconds)}`;
            text.style.marginTop = '6px';
            text.style.color = 'rgba(255,82,82,0.95)';
            const span = li.querySelector('span');
            if (span) span.parentNode.insertBefore(text, span.nextSibling);
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
            // Clamp unrealistic values (guard against milliseconds written as seconds or other bugs)
            const CLAMP_MAX = 24 * 3600; // 1 day
            const clampedFocusedTime = Math.min(newFocusedTime, CLAMP_MAX);
            console.log('DEBUG: stopFocusTimer - elapsedSeconds:', elapsedSeconds, 'newFocusedTime:', newFocusedTime, 'clamped:', clampedFocusedTime);
            li.dataset.focusedTime = clampedFocusedTime;
            updateFocusTimeOnServer(currentRunningTaskId, clampedFocusedTime);
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
        })
        .then(resp => resp.json())
        .then(data => {
            const li = document.querySelector(`li[data-id='${todoId}']`);
            if (li && typeof data.was_overdue !== 'undefined') {
                li.dataset.wasOverdue = data.was_overdue;
                if (data.was_overdue == 1 && !li.classList.contains('completed')) {
                    li.classList.add('overdue');
                }
                // Always ensure overdueTime is set (default 0)
                const reportedOverdue = parseInt(data.overdue_time) || 0;
                li.dataset.overdueTime = reportedOverdue;
                // if the server reports an overdue_time, set baseline so UI shows extra as only post-baseline
                const durationSeconds = (parseInt(li.dataset.durationHours) || 0) * 3600 + (parseInt(li.dataset.durationMinutes) || 0) * 60;
                if (reportedOverdue > 0) {
                    li.dataset.overdueBaseline = durationSeconds; // baseline is planned duration
                }
                // Sync normalized focused_time sent back by server
                if (typeof data.focused_time !== 'undefined') {
                    const norm = parseInt(data.focused_time) || 0;
                    li.dataset.focusedTime = norm;
                    // also update lastFocusedTime so subsequent session adds are correct
                    lastFocusedTime = norm;
                }
            }
        });
    }

    // Initial progress bar update and restore overdue state from dataset
    document.querySelectorAll('#todo-list li, #completed-list li').forEach(li => {
        // set overdue class from data-was-overdue (templates render this attribute)
        const wasOverdue = li.dataset.wasOverdue || li.dataset.was_overdue || li.getAttribute('data-was-overdue');
        if (wasOverdue && parseInt(wasOverdue) === 1 && !li.classList.contains('completed')) {
            li.classList.add('overdue');
        }
        // For completed tasks, ensure overdue text is placed under title (no red border)
        if (li.classList.contains('completed')) {
            // ensure left column wrapper exists — migrate simple span into task-left if needed
            const currentSpan = li.querySelector('span');
            if (currentSpan && !li.querySelector('.task-left')) {
                const wrapper = document.createElement('div');
                wrapper.classList.add('task-left');
                wrapper.appendChild(currentSpan.cloneNode(true));
                // replace original span with wrapper
                currentSpan.remove();
                li.insertBefore(wrapper, li.firstChild);
            }
            ensureCompletedOverdueIndicator(li);
        }
        updateProgressBar(li.dataset.id);
    });

    // Start a global progress checker so overdue modal appears even if user didn't press play
    if (!globalProgressCheckerInterval) {
        globalProgressCheckerInterval = setInterval(() => {
            document.querySelectorAll('#todo-list li').forEach(li => {
                const id = li.dataset.id;
                try {
                    const ft = parseInt(li.dataset.focusedTime) || 0;
                    const dh = parseInt(li.dataset.durationHours) || 0;
                    const dm = parseInt(li.dataset.durationMinutes) || 0;
                    const total = (dh * 3600) + (dm * 60);
                    const pct = total > 0 ? Math.min((ft / total) * 100, 100) : 0;
                    if (pct >= 90) console.log('DEBUG: global checker', id, 'focusedTime:', ft, 'total:', total, 'pct:', pct);

                    // Update UI progress
                    updateProgressBar(id);

                    // Force show modal if stored focused time already reached planned duration
                    if (total > 0 && ft >= total && !li.classList.contains('completed') && !li.dataset.overdueNotified) {
                        console.log('DEBUG: global checker forcing modal for stored focused_time >= total for', id);
                        // set baseline if missing
                        if (!li.dataset.overdueBaseline) li.dataset.overdueBaseline = total;
                        li.dataset.overdueNotified = 1;
                        showOverduePrompt(id, 'Planned time reached — mark complete or continue working on overdue task?');
                    }
                } catch (e) {
                    console.log('DEBUG: error reading li dataset', e);
                }
            });
        }, 1000);
    }

    // Clear on unload
    window.addEventListener('beforeunload', () => {
        if (globalProgressCheckerInterval) clearInterval(globalProgressCheckerInterval);
    });

    // Wire completed list toggle
    const completedToggle = document.getElementById('completed-toggle');
    const completedListEl = document.getElementById('completed-list');
    if (completedToggle && completedListEl) {
        completedToggle.addEventListener('click', () => {
            const expanded = completedToggle.getAttribute('aria-expanded') === 'true';
            if (expanded) {
                completedListEl.style.display = 'none';
                completedToggle.setAttribute('aria-expanded', 'false');
            } else {
                completedListEl.style.display = 'block';
                completedToggle.setAttribute('aria-expanded', 'true');
            }
        });
    }

    // Debug helpers: expose functions so user can force-check overdue and open modal from console
    window.forceCheckOverdue = function() {
        console.log('DEBUG: forceCheckOverdue called');
        document.querySelectorAll('#todo-list li').forEach(li => updateProgressBar(li.dataset.id));
    };

    window.showModalFor = function(id) {
        console.log('DEBUG: showModalFor', id);
        showOverduePrompt(id, 'Test: Planned time reached — mark complete or continue?');
    };
});