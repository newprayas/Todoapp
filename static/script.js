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
    // flags to know if user manually edited inputs
    let focusEdited = false;
    let breakEdited = false;
    // store per-task timer state when switching between tasks
    const taskTimerStates = {};
    // last session increment in seconds (most recent active focus session)
    let lastSessionIncrement = 0;

    const TASK_STATE_KEY = 'todo_task_timer_states_v1';

    function persistAllTaskStates() {
        try {
            localStorage.setItem(TASK_STATE_KEY, JSON.stringify(taskTimerStates));
        } catch (e) {
            console.log('DEBUG: persistAllTaskStates failed', e);
        }
    }

    function loadAllTaskStates() {
        try {
            const raw = localStorage.getItem(TASK_STATE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    Object.assign(taskTimerStates, parsed);
                }
            }
        } catch (e) {
            console.log('DEBUG: loadAllTaskStates failed', e);
        }
    }

    function saveTaskTimerState(taskId) {
        if (!taskId) return;
        // compute lastFocusedTime up-to-date if a focus session is active
        let persistedLastFocused = lastFocusedTime;
        if (focusSessionStartTime > 0 && currentRunningTaskId === taskId) {
            const elapsed = Math.floor((Date.now() - focusSessionStartTime) / 1000);
            persistedLastFocused = lastFocusedTime + elapsed;
        }
        taskTimerStates[taskId] = {
            timerState: 'paused', // always pause when switching away
            currentMode: currentMode,
            timeRemaining: timeRemaining || null,
            totalCycles: totalCycles || parseInt(cycleCountInput.value) || null,
            // persist user-editable pomodoro inputs so they restore per-task
            focusDuration: (typeof focusDurationInput !== 'undefined' && focusDurationInput.value) ? parseInt(focusDurationInput.value) || null : null,
            breakDuration: (typeof breakDurationInput !== 'undefined' && breakDurationInput.value) ? parseInt(breakDurationInput.value) || null : null,
            currentCycle: currentCycle || 0,
            lastFocusedTime: persistedLastFocused || 0
        };
    persistAllTaskStates();
    }

    function restoreTaskTimerState(taskId) {
    // ensure we have any persisted states loaded
    if (Object.keys(taskTimerStates).length === 0) loadAllTaskStates();
    const s = taskTimerStates[taskId];
        if (!s) return false;
        // restore fields into global state but keep timer paused
        timerState = 'paused';
        currentMode = s.currentMode || 'focus';
        timeRemaining = (typeof s.timeRemaining !== 'undefined' && s.timeRemaining !== null) ? s.timeRemaining : null;
        totalCycles = s.totalCycles || null;
        currentCycle = s.currentCycle || 0;
        lastFocusedTime = s.lastFocusedTime || 0;
        // update UI
        if (totalCycles) cycleCountInput.value = totalCycles;
        // restore persisted focus/break inputs if present
        if (typeof s.focusDuration !== 'undefined' && s.focusDuration !== null) {
            focusDurationInput.value = s.focusDuration;
        }
        if (typeof s.breakDuration !== 'undefined' && s.breakDuration !== null) {
            breakDurationInput.value = s.breakDuration;
        }
        // clear edit flags since we've just restored values
        focusEdited = false;
        breakEdited = false;
        if (timeRemaining) updateTimerDisplay();
        updateSessionDisplay();
        return true;
    }

    // Add a new to-do item
    addButton.addEventListener('click', () => {
        const todoText = todoInput.value.trim();
        // treat empty hour/minute as 0; require at least one > 0
        const durationHoursRaw = durationHoursInput.value.trim();
        const durationMinutesRaw = durationMinutesInput.value.trim();
        const durationHours = durationHoursRaw === '' ? '0' : durationHoursRaw;
        const durationMinutes = durationMinutesRaw === '' ? '0' : durationMinutesRaw;

        if (!todoText) {
            alert('Task name is required');
            return;
        }
        // require at least one of hours or minutes to be > 0
        if ((parseInt(durationHours) || 0) === 0 && (parseInt(durationMinutes) || 0) === 0) {
            alert('Please enter a duration in hours or minutes');
            return;
        }

        // proceed to create
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
                    // save state for previous task
                    saveTaskTimerState(currentRunningTaskId);
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
                // restore previous saved state if any
                const restored = restoreTaskTimerState(todoId);
                if (!restored) {
                    // set defaults
                    timerState = 'paused';
                    currentMode = 'focus';
                    timeRemaining = null;
                    currentCycle = 0;
                    pomodoroTimerDisplay.textContent = '25:00';
                    cycleCountInput.value = '';
                }
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
                            // Notify uncompletion? skip notification for uncomplete
                        } else { // Task is being completed
                            li.classList.remove('overdue');
                            // If task was overdue, move visual indicator from card to a small badge next to title
                            const wasOverdue = li.dataset.wasOverdue || li.getAttribute('data-was-overdue');
                            if (wasOverdue && parseInt(wasOverdue) === 1) {
                                // add red-circle badge emoji
                                addOverdueBadge(li);
                            }

                            li.classList.add('completed');
                            doneButtonIcon.classList.remove('fa-check');
                            doneButtonIcon.classList.add('fa-undo');
                            // remove any live overdue-extra (session-only) to avoid inline display
                            const extraEl = li.querySelector('.overdue-extra'); if (extraEl) extraEl.remove();
                            // Prepend so most-recent completed task appears at the top
                            if (completedList.firstChild) completedList.insertBefore(li, completedList.firstChild);
                            else completedList.appendChild(li);
                            // Browser notification and sound for completion
                            try { sendNotification('Task completed', `${todoText} — marked complete`, 'complete'); } catch(e){}
                            // Ensure completed overdue text is placed under the title for consistency
                            const wasOverdueNow = li.dataset.wasOverdue || li.getAttribute('data-was-overdue');
                            if (wasOverdueNow && parseInt(wasOverdueNow) === 1) {
                                ensureCompletedOverdueIndicator(li);
                            } else {
                                // add appropriate completed status label
                                ensureCompletedStatusIndicator(li);
                            }

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

    // track manual edits to focus/break so starting can re-init timer when needed
    focusDurationInput.addEventListener('input', () => { 
        focusEdited = true; 
        if (currentRunningTaskId) saveTaskTimerState(currentRunningTaskId);
    });
    breakDurationInput.addEventListener('input', () => { 
        breakEdited = true; 
        if (currentRunningTaskId) saveTaskTimerState(currentRunningTaskId);
    });

    pomodoroStartPauseBtn.addEventListener('click', () => {
        if (timerState === 'paused') {
            const focusDuration = parseInt(focusDurationInput.value);
            const breakDuration = parseInt(breakDurationInput.value);
            totalCycles = parseInt(cycleCountInput.value);

            // Validate inputs
            if (isNaN(focusDuration) || isNaN(breakDuration) || isNaN(totalCycles) || focusDuration <= 0 || breakDuration <= 0 || totalCycles <= 0) {
                alert('Please enter valid values for focus, break, and cycles.');
                return;
            }

            // If a task is selected, ensure the focus duration does not exceed the task's total planned duration
            // Apply this rule only for normal (non-overdue) tasks. Skip validation for overdue tasks and overdue pomodoro sessions.
            if (currentRunningTaskId) {
                try {
                    const li = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
                    // Skip validation for overdue tasks (server-reported overdue or UI class)
                    const isOverdue = (li && (li.dataset.wasOverdue && parseInt(li.dataset.wasOverdue) === 1)) || (li && parseInt(li.dataset.overdueTime) > 0) || (li && li.classList && li.classList.contains('overdue'));
                    if (!isOverdue) {
                        const rem = computeRemainingPlannedSeconds(currentRunningTaskId);
                        if (rem && typeof rem.total !== 'undefined') {
                            if ((focusDuration * 60) > rem.total) {
                                alert('Focus duration cannot be longer than the task duration. Please reduce the focus duration or increase the task duration.');
                                return;
                            }
                        }
                    }
                } catch (e) {
                    console.log('DEBUG: focus duration validation failed', e);
                }
            }

            // Ensure the session display reflects the newly entered cycles immediately
            updateSessionDisplay();

            // Initialize timeRemaining taking into account manual edits
            if (!timeRemaining) {
                // Cap the initial focus period to the remaining planned time for this task (if available and not overdue)
                if (currentRunningTaskId) {
                    const rem = computeRemainingPlannedSeconds(currentRunningTaskId);
                    if (rem && rem.remaining !== undefined && rem.remaining > 0 && rem.remaining < (focusDuration * 60)) {
                        timeRemaining = rem.remaining;
                    } else {
                        timeRemaining = focusDuration * 60;
                    }
                } else {
                    timeRemaining = focusDuration * 60;
                }
                currentCycle++;
                updateSessionDisplay();
            } else if (currentMode === 'focus' && focusEdited && timerState === 'paused') {
                // If user changed focus duration manually while paused but timeRemaining still held old value,
                // reset the timer to the new focus duration for the upcoming start (but keep currentCycle).
                timeRemaining = focusDuration * 60;
                updateTimerDisplay();
                updateSessionDisplay();
            } else if (currentMode === 'break' && breakEdited && timerState === 'paused') {
                timeRemaining = breakDuration * 60;
                updateTimerDisplay();
                updateSessionDisplay();
            }
            startTimer();
        } else {
            pauseTimer();
        }
    });

    // If user edits the cycles input manually, reflect it immediately in UI and state
    cycleCountInput.addEventListener('input', () => {
        const v = parseInt(cycleCountInput.value);
        if (!isNaN(v) && v > 0) {
            totalCycles = v;
            updateSessionDisplay();
            // persist per-task if a task is currently selected
            if (currentRunningTaskId) saveTaskTimerState(currentRunningTaskId);
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
            // Cap the focus session by remaining planned seconds for the selected task
            if (currentRunningTaskId) {
                const rem = computeRemainingPlannedSeconds(currentRunningTaskId);
                if (rem && rem.remaining !== undefined && rem.remaining > 0 && rem.remaining < (focusDuration * 60)) {
                    timeRemaining = rem.remaining;
                } else {
                    timeRemaining = focusDuration * 60;
                }
            } else {
                timeRemaining = focusDuration * 60;
            }
            // increment cycle since user is starting a new focus session
            currentCycle++;
            updateSessionDisplay();
            console.log('DEBUG: focusDuration (mins):', focusDuration, 'timeRemaining (s):', timeRemaining, 'currentCycle:', currentCycle);
            triggerFlashAnimation('red');
            startTimer();
        }
    });

    pomodoroResetBtn.addEventListener('click', () => {
    // Reset UI and subtract only the current session's increment from the task's progress
    resetPomodoroAndProgress(currentRunningTaskId);
    });

    pomodoroCloseButton.addEventListener('click', () => {
        hidePomodoroTimer();
    });

    function startTimer() {
    timerState = 'running';
        pomodoroStartPauseBtn.textContent = 'Pause';
    // user edits applied; clear the edit flags now that timer is running
    focusEdited = false;
    breakEdited = false;
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
            // Notify user that focus started
            try { sendNotification('Focus started', 'Focus timer started', 'start'); } catch(e){}
            
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
            // Notify user that break started
            try { sendNotification('Break started', 'Break timer started', 'break'); } catch(e){}
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

    // Reset both Pomodoro UI and the task's persisted focused_time (server + UI)
    function resetPomodoroAndProgress(taskId) {
        // Reset UI timer
        resetTimer();
        // Only subtract the last session increment from the focused_time persisted for this task
        if (taskId) {
            const li = document.querySelector(`li[data-id='${taskId}']`);
            if (li) {
                const persisted = parseInt(li.dataset.focusedTime) || 0;
                const subtract = Math.max(0, lastSessionIncrement || 0);
                const newVal = Math.max(0, persisted - subtract);
                li.dataset.focusedTime = newVal;
                // update overdue_time/wasOverdue based on new focused value (server will compute normalization)
                updateFocusTimeOnServer(taskId, newVal);
                // remove only the live extra visual showing session-only overtime
                const extra = li.querySelector('.overdue-extra'); if (extra) extra.remove();
                // update progress bar to reflect new persisted focused time
                updateProgressBar(taskId);
            }
        }
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

    // Helper: compute remaining planned seconds for a task from dataset (total - persistedFocused)
    function computeRemainingPlannedSeconds(taskId) {
        const li = document.querySelector(`li[data-id='${taskId}']`);
        if (!li) return null;
        const dh = parseInt(li.dataset.durationHours) || 0;
        const dm = parseInt(li.dataset.durationMinutes) || 0;
        const total = (dh * 3600) + (dm * 60);
        const persisted = parseInt(li.dataset.focusedTime) || 0;
        const remaining = Math.max(0, total - persisted);
        return { total, persisted, remaining };
    }

    function handleSessionEnd() {
        stopFocusTimer();

        const li = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
        if (!li) {
            resetPomodoro(); // or handle error appropriately
            return;
        }

        if (currentMode === 'focus') {
            if (currentCycle >= totalCycles) {
                try { sendNotification('All cycles completed', 'You finished all cycles', 'complete'); } catch(e){}
                const taskName = pomodoroTask.textContent || '';
                showCompletionPrompt(currentRunningTaskId, taskName || 'Task', 'All focus sessions completed');
            } else {
                const breakDuration = parseInt(breakDurationInput.value);
                if (!isNaN(breakDuration) && breakDuration > 0) {
                    currentMode = 'break';
                    timeRemaining = breakDuration * 60;
                    startTimer();
                } else {
                    resetPomodoro();
                }
            }
        } else { // currentMode is 'break'
            currentMode = 'focus';
            currentCycle++;
            updateSessionDisplay();
            const focusDuration = parseInt(focusDurationInput.value);
            if (!isNaN(focusDuration) && focusDuration > 0) {
                timeRemaining = focusDuration * 60;
                showNotification('Break ended! Time to focus.', 'Start Focus');
                try { sendNotification('Break ended', 'Time to focus', 'start'); } catch(e){}
                startTimer();
            } else {
                resetPomodoro();
            }
        }
    }

    // Show completion modal when all cycles finish
    function showCompletionPrompt(todoId, taskName, subtitle) {
        const modal = document.getElementById('global-overdue-modal');
        const messageEl = document.getElementById('global-overdue-message');
        // Reuse modal layout but change buttons and text
        messageEl.innerHTML = `
            <div class="modal-message-main"><span class="modal-task-name">${taskName}</span></div>
            <div style="margin-top:8px; font-size:0.95em;">${subtitle}</div>
        `;
        modal.style.display = 'flex';
        // Hide the Pomodoro UI while showing the completion modal without resetting internal state
        try {
            if (pomodoroContainer) pomodoroContainer.style.display = 'none';
            if (todoContainer) todoContainer.classList.remove('pomodoro-active');
        } catch (e) {
            console.log('DEBUG: showCompletionPrompt hide UI failed', e);
        }
        const markBtn = document.getElementById('modal-mark-complete');
        const contBtn = document.getElementById('modal-continue');
        // Rename buttons: primary -> Close/OK, secondary -> Dismiss
        markBtn.style.display = 'none';
        contBtn.textContent = 'Dismiss';
        // Unbind handlers by cloning
        const contClone = contBtn.cloneNode(true);
        contBtn.parentNode.replaceChild(contClone, contBtn);
        const dismiss = document.getElementById('modal-continue');
        dismiss.addEventListener('click', () => { modal.style.display = 'none'; });
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
                // make sure any live extra overdue visuals are removed before showing completed layout
                const extra = li.querySelector('.overdue-extra'); if (extra) extra.remove();
                li.classList.add('completed');
                // Prepend completed items so newest-completed appear at the top
                if (completedList.firstChild) completedList.insertBefore(li, completedList.firstChild);
                else completedList.appendChild(li);
                // If this completed task had overdue time persisted, show the small overdue indicator under the title
                if (parseInt(li.dataset.overdueTime) > 0 || parseInt(li.dataset.wasOverdue) === 1) {
                    ensureCompletedOverdueIndicator(li);
                } else {
                    ensureCompletedStatusIndicator(li);
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
        const persistedFocused = parseInt(li.dataset.focusedTime) || 0;
        let currentFocusedTime = persistedFocused;
        // If this task is currently being focused, add the ongoing session time
        let currentSessionTime = 0;
        if (focusSessionStartTime > 0 && currentRunningTaskId === todoId && timerState === 'running') {
            currentSessionTime = Math.floor((Date.now() - focusSessionStartTime) / 1000);
            currentFocusedTime += currentSessionTime;
        }

        // debug snapshot for tracing
        console.log('DEBUG: updateProgressBar snapshot', { todoId, persistedFocused, currentSessionTime, currentFocusedTime, timerState, currentMode, focusSessionStartTime });

    const progressBar = li.querySelector('.progress-bar');
    const progressContainer = li.querySelector('.progress-bar-container');
        if (totalDurationInSeconds > 0) {
            const progress = Math.min((currentFocusedTime / totalDurationInSeconds) * 100, 100);
            progressBar.style.width = `${progress}%`;
            // Mark the task as overdue (red card) when fully completed but not toggled as done
            const previousFocused = parseInt(li.dataset.focusedTime) || 0;
            const crossed = (previousFocused < totalDurationInSeconds) && (currentFocusedTime >= totalDurationInSeconds);
            if (currentFocusedTime >= totalDurationInSeconds && !li.classList.contains('completed')) {
                li.classList.add('overdue');
            } else {
                li.classList.remove('overdue');
            }

            // If progress reached 100% while actively running, immediately pause/stop timers and show modal once.
            // If progress is 100% due to persisted focused time (not actively running) then just mark as crossed
            // and let the global checker handle showing the modal (it skips items under processing).
            if (currentFocusedTime >= totalDurationInSeconds && !li.dataset.overdueNotified && !li.classList.contains('completed')) {
                const isActiveRunning = (focusSessionStartTime > 0 && currentRunningTaskId === todoId && timerState === 'running' && currentMode === 'focus');
                if (isActiveRunning) {
                    // actively crossed while running — handle immediately
                    console.log('DEBUG: updateProgressBar detected active running crossing for', todoId);
                        triggerOverdueForTaskLocal(todoId, totalDurationInSeconds);
                } else if (crossed) {
                    // Persisted crossing occurred; mark crossed and let global checker decide when to show modal
                    try { li.dataset.overdueCrossed = 1; } catch (e) {}
                    console.log('DEBUG: updateProgressBar marked overdueCrossed for', todoId);
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

    // triggerOverdueForTask is implemented in module scope (moved out) so callers outside updateProgressBar can access it.

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

    function showOverduePrompt(message) {
        try { sendNotification('Task Overdue', 'Your task is now overdue. Mark complete or continue?', 'complete'); } catch(e){}
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
    console.log('DEBUG: showOverduePrompt opened modal for', todoId, 'taskName:', taskName);
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
                            // Prepend so most-recent completed task appears at top
                            if (completedList.firstChild) completedList.insertBefore(li, completedList.firstChild);
                            else completedList.appendChild(li);
                            try { sendNotification('Task completed', `${taskName} — marked complete`, 'complete'); } catch(e){}
                            const wasOverdue = li.dataset.wasOverdue || li.getAttribute('data-was-overdue');
                            if (wasOverdue && parseInt(wasOverdue) === 1) {
                                addOverdueBadge(li);
                                // Move any displayed overdue-extra (live overdue time) to the completed-overdue-text
                                // so it appears on a new line under the title immediately.
                                const extra = li.querySelector('.overdue-extra');
                                if (extra) {
                                    // create/replace completed-overdue-text with the same content but insert inside .task-left
                                    const prev = li.querySelector('.completed-overdue-text');
                                    if (prev) prev.remove();
                                    const text = document.createElement('div');
                                    text.classList.add('completed-overdue-text');
                                    text.textContent = extra.textContent.replace('Overdue time:', 'Overdue:');
                                    text.style.marginTop = '6px';
                                    text.style.color = 'rgba(255,82,82,0.95)';
                                    // ensure .task-left exists and insert after the title span
                                    let container = li.querySelector('.task-left');
                                    if (!container) {
                                        const currentSpan = li.querySelector('span');
                                        if (currentSpan) {
                                            const wrapper = document.createElement('div');
                                            wrapper.classList.add('task-left');
                                            wrapper.appendChild(currentSpan.cloneNode(true));
                                            currentSpan.remove();
                                            li.insertBefore(wrapper, li.firstChild);
                                            container = wrapper;
                                        }
                                    }
                                    if (container) {
                                        const titleSpan = container.querySelector('span');
                                        if (titleSpan) titleSpan.parentNode.insertBefore(text, titleSpan.nextSibling);
                                        else container.appendChild(text);
                                    } else {
                                        li.appendChild(text);
                                    }
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
        // Remove any live session-only overtime element
        const liveExtra = li.querySelector('.overdue-extra'); if (liveExtra) liveExtra.remove();

        const overdueSeconds = parseInt(li.dataset.overdueTime) || 0;
        if (overdueSeconds > 0) {
            const text = document.createElement('div');
            text.classList.add('completed-overdue-text');
            text.textContent = `Overdue: ${formatDuration(overdueSeconds)}`;
            text.style.marginTop = '6px';
            text.style.color = 'rgba(255,82,82,0.95)';
            // Prefer to insert inside the .task-left wrapper immediately after the title span
            let container = li.querySelector('.task-left');
            if (!container) {
                // migrate existing single span into a .task-left wrapper
                const currentSpan = li.querySelector('span');
                if (currentSpan) {
                    const wrapper = document.createElement('div');
                    wrapper.classList.add('task-left');
                    wrapper.appendChild(currentSpan.cloneNode(true));
                    currentSpan.remove();
                    li.insertBefore(wrapper, li.firstChild);
                    container = wrapper;
                }
            }
            if (container) {
                // remove any old completed-overdue-text inside container to avoid ordering issues
                const prevInside = container.querySelector('.completed-overdue-text'); if (prevInside) prevInside.remove();
                // insert after the title span
                const titleSpan = container.querySelector('span');
                if (titleSpan) {
                    titleSpan.parentNode.insertBefore(text, titleSpan.nextSibling);
                } else {
                    container.appendChild(text);
                }
            } else {
                // fallback: append to li so it appears on its own line
                li.appendChild(text);
            }
        }
    }

    // --- Browser notifications + sound helpers ---
    function playSound(soundType) {
        let soundFile = '';
        if (soundType === 'break') {
            soundFile = '/static/sounds/Break timer start.wav';
        } else if (soundType === 'start') {
            soundFile = '/static/sounds/Focus timer start.wav';
        } else if (soundType === 'complete') {
            soundFile = '/static/sounds/progress bar full.wav';
        }

        if (soundFile) {
            const audio = new Audio(soundFile);
            audio.play().catch(e => console.log('Audio play failed', e));
        }
    }

    function ensureNotificationPermission() {
        if (!('Notification' in window)) return Promise.resolve(false);
        if (Notification.permission === 'granted') return Promise.resolve(true);
        if (Notification.permission === 'denied') return Promise.resolve(false);
        return Notification.requestPermission().then(p => p === 'granted');
    }

    function sendNotification(title, body, soundType) {
        ensureNotificationPermission().then(ok => {
            if (!ok) return;
            try {
                const n = new Notification(title, { body });
                // play a short sound for the notification
                try { playSound(soundType); } catch(e) { console.log('playSound failed', e); }
                // close after a few seconds
                setTimeout(() => { try { n.close(); } catch(e) {} }, 5000);
            } catch (e) {
                console.log('Notification failed', e);
            }
        });
    }

    // For completed tasks, add a label below title:
    // - If task was marked completed BEFORE reaching full planned progress => 'Underdue task' (yellow)
    // - If task reached planned progress (no overdue) => 'Completed task' (green)
    function ensureCompletedStatusIndicator(li) {
        if (!li) return;
        // remove any previous status indicators
        const prevOverdue = li.querySelector('.completed-overdue-text'); if (prevOverdue) prevOverdue.remove();
        const prevUnderdue = li.querySelector('.completed-underdue-text'); if (prevUnderdue) prevUnderdue.remove();
        const prevComplete = li.querySelector('.completed-complete-text'); if (prevComplete) prevComplete.remove();

        // compute whether task was completed before planned duration or after
        const focused = parseInt(li.dataset.focusedTime) || 0;
        const overdue = parseInt(li.dataset.overdueTime) || 0;
        const dh = parseInt(li.dataset.durationHours) || 0;
        const dm = parseInt(li.dataset.durationMinutes) || 0;
        const total = (dh * 3600) + (dm * 60);

        // If there is overdue time, show overdue indicator (handled by ensureCompletedOverdueIndicator)
        if (overdue > 0) {
            ensureCompletedOverdueIndicator(li);
            return;
        }

        // If no planned duration, do nothing
        if (total <= 0) return;

        // If focusedTime < total when marked complete => underdue
        if (focused < total) {
            const text = document.createElement('div');
            text.classList.add('completed-underdue-text');
            text.textContent = 'Underdue task';
            // Prefer inserting inside .task-left under the title span
            let container = li.querySelector('.task-left');
            if (!container) {
                const currentSpan = li.querySelector('span');
                if (currentSpan) {
                    const wrapper = document.createElement('div');
                    wrapper.classList.add('task-left');
                    wrapper.appendChild(currentSpan.cloneNode(true));
                    currentSpan.remove();
                    li.insertBefore(wrapper, li.firstChild);
                    container = wrapper;
                }
            }
            if (container) {
                // insert after the title span inside the wrapper
                const titleSpan = container.querySelector('span');
                if (titleSpan) titleSpan.parentNode.insertBefore(text, titleSpan.nextSibling);
                else container.appendChild(text);
            } else {
                li.appendChild(text);
            }
            return;
        }

        // If reached planned duration and no overdue => Completed task
        if (focused >= total && overdue === 0) {
            const text = document.createElement('div');
            text.classList.add('completed-complete-text');
            text.textContent = 'Completed task';
            let container = li.querySelector('.task-left');
            if (!container) {
                const currentSpan = li.querySelector('span');
                if (currentSpan) {
                    const wrapper = document.createElement('div');
                    wrapper.classList.add('task-left');
                    wrapper.appendChild(currentSpan.cloneNode(true));
                    currentSpan.remove();
                    li.insertBefore(wrapper, li.firstChild);
                    container = wrapper;
                }
            }
            if (container) {
                const titleSpan = container.querySelector('span');
                if (titleSpan) titleSpan.parentNode.insertBefore(text, titleSpan.nextSibling);
                else container.appendChild(text);
            } else {
                li.appendChild(text);
            }
            return;
        }
    }

    function startFocusTimer() {
        focusSessionStartTime = Date.now();
        const li = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
        if (li) {
            lastFocusedTime = parseInt(li.dataset.focusedTime) || 0;
            // clear any transient crossed flag when user actively starts a session
            try { if (li.dataset.overdueCrossed) { delete li.dataset.overdueCrossed; console.log('DEBUG: startFocusTimer cleared overdueCrossed for', currentRunningTaskId); } } catch (e) {}
            console.log('DEBUG: startFocusTimer - task', currentRunningTaskId, 'lastFocusedTime(dataset):', li.dataset.focusedTime, 'lastFocusedTime(var):', lastFocusedTime, 'focusSessionStartTime:', focusSessionStartTime);
        }
    }

    function stopFocusTimer() {
        if (focusSessionStartTime === 0) return;

        const elapsedSeconds = Math.floor((Date.now() - focusSessionStartTime) / 1000);
        focusSessionStartTime = 0; // Reset start time BEFORE calculating new focused time
        lastSessionIncrement = elapsedSeconds;
        const li = document.querySelector(`li[data-id='${currentRunningTaskId}']`);
        if (li) {
            try { li.dataset.processing = 1; console.log('DEBUG: stopFocusTimer set processing for', li.dataset.id); } catch (e) { /* ignore */ }
            const newFocusedTime = lastFocusedTime + elapsedSeconds;
            const CLAMP_MAX = 24 * 3600; // 1 day
            const clampedFocusedTime = Math.min(newFocusedTime, CLAMP_MAX);
            console.log('DEBUG: stopFocusTimer - elapsedSeconds:', elapsedSeconds, 'newFocusedTime:', newFocusedTime, 'clamped:', clampedFocusedTime);
            li.dataset.focusedTime = clampedFocusedTime;
            updateFocusTimeOnServer(currentRunningTaskId, clampedFocusedTime);
            lastFocusedTime = newFocusedTime;
            updateProgressBar(currentRunningTaskId);
        }
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
                // clear any temporary processing flag now that server responded
                try { delete li.dataset.processing; console.log('DEBUG: updateFocusTimeOnServer cleared processing for', todoId); } catch (e) {}
            }
        });
        // Fallback: clear processing after 1.5s in case server is slow or network fails
        setTimeout(() => {
            try { const li = document.querySelector(`li[data-id='${todoId}']`); if (li && li.dataset && li.dataset.processing) { delete li.dataset.processing; console.log('DEBUG: updateFocusTimeOnServer fallback cleared processing for', todoId); } } catch (e) {}
        }, 1500);
    }

        // Centralized handler to pause/stop timers and show the overdue prompt for a task.
        // Placed in module scope so it is callable from the global checker and other places.
        function triggerOverdueForTaskLocal(todoId, baselineSeconds) {
            const li = document.querySelector(`li[data-id='${todoId}']`);
            if (!li) return;
            if (li.dataset.overdueNotified) return;
            // mark processing so global checker skips this item while we handle overdue
            try { li.dataset.processing = 1; console.log('DEBUG: triggerOverdueForTask set processing for', todoId); } catch (e) { /* ignore */ }
            li.dataset.overdueNotified = 1;
            if (!li.dataset.overdueBaseline) li.dataset.overdueBaseline = baselineSeconds || (parseInt(li.dataset.durationHours || 0) * 3600) + (parseInt(li.dataset.durationMinutes || 0) * 60);
            console.log('DEBUG: triggerOverdueForTask - pausing timers and showing modal for', todoId);
            try {
                // Pause UI timers and clear intervals
                pauseTimer();
            } catch (e) {
                console.log('DEBUG: triggerOverdueForTask pauseTimer failed', e);
            }
            try {
                // Ensure any active focus session is stopped and persisted
                stopFocusTimer();
            } catch (e) {
                console.log('DEBUG: triggerOverdueForTask stopFocusTimer failed', e);
            }
            // Also hide the Pomodoro UI without resetting internal pomodoro state
            try {
                if (pomodoroContainer) pomodoroContainer.style.display = 'none';
                if (todoContainer) todoContainer.classList.remove('pomodoro-active');
            } catch (e) {
                console.log('DEBUG: triggerOverdueForTask hide UI failed', e);
            }
            // ensure processing flag is cleared after a short grace period in case server doesn't respond
            setTimeout(() => {
                try { delete li.dataset.processing; console.log('DEBUG: triggerOverdueForTask cleared processing for', todoId); } catch (e) {}
            }, 800);
            // Decide whether to actually show the modal: require the rendered progress bar to be full
            try {
                const pb = li.querySelector('.progress-bar');
                let renderedPct = 0;
                if (pb && pb.style && pb.style.width && pb.style.width.endsWith('%')) {
                    renderedPct = parseFloat(pb.style.width.replace('%','')) || 0;
                } else {
                    const dh = parseInt(li.dataset.durationHours) || 0;
                    const dm = parseInt(li.dataset.durationMinutes) || 0;
                    const total = (dh * 3600) + (dm * 60);
                    const ft = parseInt(li.dataset.focusedTime) || 0;
                    renderedPct = total > 0 ? Math.min((ft / total) * 100, 100) : 0;
                }
                const isActiveRunning = (focusSessionStartTime > 0 && currentRunningTaskId === todoId && timerState === 'running' && currentMode === 'focus');
                console.log('DEBUG: triggerOverdueForTask renderedPct for', todoId, renderedPct, 'isActiveRunning:', isActiveRunning);
                if (renderedPct < 100 && !isActiveRunning) {
                    // Not visually full yet — mark crossed and defer showing modal to global checker once UI stabilizes
                    try { li.dataset.overdueCrossed = 1; } catch (e) {}
                    // clear processing flag we set earlier since we're not showing modal now
                    try { delete li.dataset.processing; } catch (e) {}
                    console.log('DEBUG: triggerOverdueForTask deferred modal for', todoId, 'renderedPct:', renderedPct);
                } else {
                    // Finally show modal to let the user choose
                    showOverduePrompt(todoId, 'Planned time reached — mark complete or continue working on overdue task?');
                }
            } catch (e) {
                console.log('DEBUG: triggerOverdueForTask modal decision error', e);
                showOverduePrompt(todoId, 'Planned time reached — mark complete or continue working on overdue task?');
            }
        }

    // Initial progress bar update and restore overdue state from dataset
    // Ensure completed-list shows newest-first by sorting existing items by data-id descending
    const completedItemsInitial = Array.from(document.querySelectorAll('#completed-list li'));
    if (completedItemsInitial.length > 1) {
        completedItemsInitial.sort((a, b) => parseInt(b.dataset.id) - parseInt(a.dataset.id));
        const completedListEl = document.getElementById('completed-list');
        completedItemsInitial.forEach(item => completedListEl.appendChild(item));
    }

    // Note: callers use triggerOverdueForTaskLocal directly.

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
            // Show the appropriate completed label (overdue / underdue / completed)
            if (parseInt(li.dataset.overdueTime) > 0 || parseInt(li.dataset.wasOverdue) === 1) {
                ensureCompletedOverdueIndicator(li);
            } else {
                ensureCompletedStatusIndicator(li);
            }
        }
        updateProgressBar(li.dataset.id);
    });

    // Start a global progress checker so overdue modal appears even if user didn't press play
    if (!globalProgressCheckerInterval) {
        globalProgressCheckerInterval = setInterval(() => {
            document.querySelectorAll('#todo-list li').forEach(li => {
                // If this li is in processing state (just persisted by client/server sync), skip to avoid race
                if (li.dataset.processing) {
                    // short debug trace
                    console.log('DEBUG: global checker skipping processing li', li.dataset.id);
                    return;
                }
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

                    // Use the actual rendered progress bar width when available to decide if UI is truly at 100%.
                    let progressPct = 0;
                    try {
                        const pb = li.querySelector('.progress-bar');
                        if (pb && pb.style && pb.style.width && pb.style.width.endsWith('%')) {
                            progressPct = parseFloat(pb.style.width.replace('%','')) || 0;
                        } else {
                            progressPct = total > 0 ? Math.min((ft / total) * 100, 100) : 0;
                        }
                    } catch (e) {
                        progressPct = total > 0 ? Math.min((ft / total) * 100, 100) : 0;
                    }

                    // Force show modal only when rendered progress is 100% AND:
                    // - server reports overdue (li.dataset.overdueTime > 0), OR
                    // - this is an active running focus session (we're over while running), OR
                    // - we previously marked it as crossed (deferred handling)
                    if (total > 0 && progressPct >= 100 && !li.classList.contains('completed') && !li.dataset.overdueNotified) {
                        const persistedOverdue = parseInt(li.dataset.overdueTime) || 0;
                        console.log('DEBUG: global checker found progressPct >= 100 for', id, 'pct:', progressPct, 'persistedOverdue:', persistedOverdue, 'processing:', !!li.dataset.processing);

                        // If there's no server-reported overdue and the task is not actively running,
                        // it's likely a small persisted overage or race; skip triggering until real activity.
                        const isActiveRunning = (currentRunningTaskId && currentRunningTaskId === id && timerState === 'running' && currentMode === 'focus');
                        const wasCrossed = !!li.dataset.overdueCrossed;

                        if (!isActiveRunning && persistedOverdue === 0 && !wasCrossed) {
                            console.log('DEBUG: global checker skipping trigger for', id, '— no server-overdue and not actively running');
                            // set baseline so future checks know the planned time
                            if (!li.dataset.overdueBaseline) li.dataset.overdueBaseline = total;
                            return;
                        }

                        console.log('DEBUG: global checker triggering overdue handler for', id, 'isActiveRunning:', isActiveRunning, 'wasCrossed:', wasCrossed);
                        if (!li.dataset.overdueBaseline) li.dataset.overdueBaseline = total;
                        // If active running, defer to trigger handler to pause and show modal
                        triggerOverdueForTaskLocal(id, total);
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

    // Clear All completed tasks handler
    const clearCompletedBtn = document.getElementById('clear-completed-button');
    if (clearCompletedBtn) {
        clearCompletedBtn.addEventListener('click', () => {
            const completedItems = Array.from(document.querySelectorAll('#completed-list li'));
            if (completedItems.length === 0) return;
            // Confirm destructive action
            if (!confirm(`Clear ${completedItems.length} completed task(s)? This cannot be undone.`)) return;

            // Optimistically remove from UI and issue delete requests
            completedItems.forEach(li => {
                const id = li.dataset.id;
                // Remove from DOM immediately for responsiveness
                li.remove();
                // Call server to delete
                fetch('/delete', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: id }),
                })
                .then(res => res.json())
                .then(data => {
                    if (!data || data.result !== 'success') {
                        console.log('DEBUG: failed to delete completed todo', id, data);
                        // On failure, we could refresh the page to reconcile, but keep simple for now
                    }
                })
                .catch(err => console.log('DEBUG: error deleting completed todo', id, err));
            });
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

    // Test helper: reset a task's focused time to zero (client + server) for clean reproduction
    window.resetTaskProgress = function(id) {
        try {
            const li = document.querySelector(`li[data-id='${id}']`);
            if (li) {
                li.dataset.focusedTime = 0;
                li.dataset.overdueTime = 0;
                li.dataset.wasOverdue = 0;
                li.classList.remove('overdue');
                updateProgressBar(id);
            }
            // Also ask server to reset
            fetch('/update_focus_time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, focused_time: 0 }) })
            .then(r => r.json()).then(() => { console.log('DEBUG: resetTaskProgress server responded for', id); }).catch(e => console.log('DEBUG: resetTaskProgress server error', e));
        } catch (e) { console.log('DEBUG: resetTaskProgress failed', e); }
    };
});
