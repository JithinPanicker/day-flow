// --- INIT DB ---
const db = new Dexie('DayFlowDB');
db.version(2).stores({ entries: '++id, date' });

const topToast = Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 2000, background: '#1DA1F2', color: '#fff' });

// --- GLOBALS ---
let currentTimerInterval = null;
let currentOpenedEntryId = null;
const gradients = ['var(--grad-card-1)', 'var(--grad-card-2)', 'var(--grad-card-3)', 'var(--grad-card-4)'];

// --- UI HELPERS ---
function openForm(id = null) {
    document.getElementById('formModal').classList.remove('hidden');
    document.getElementById('viewModal').classList.add('hidden');
    document.body.style.overflow = 'hidden';
    
    if(!id) {
        document.getElementById('entryForm').reset();
        document.getElementById('entryId').value = "";
        document.getElementById('entryDate').valueAsDate = new Date();
        document.getElementById('deleteBtn').style.display = 'none';
        document.getElementById('timetableContainer').innerHTML = '';
        addTimeSlot();
    }
}

function closeForm() { document.getElementById('formModal').classList.add('hidden'); document.body.style.overflow = 'auto'; loadEntries(); }
function closeView() { document.getElementById('viewModal').classList.add('hidden'); document.body.style.overflow = 'auto'; clearInterval(currentTimerInterval); }

// --- FORM BUILDER ---
function addTimeSlot(slot = {}) {
    const container = document.getElementById('timetableContainer');
    const slotId = slot.id || 'slot_' + Date.now() + Math.random().toString(36).substr(2, 5);
    
    const div = document.createElement('div');
    div.className = 'slot-builder';
    div.innerHTML = `
        <input type="hidden" class="ts-id" value="${slotId}">
        <input type="hidden" class="ts-status" value="${slot.status || 'pending'}">
        <input type="hidden" class="ts-elapsed" value="${slot.elapsed || 0}">
        <input type="hidden" class="ts-logs" value='${JSON.stringify(slot.logs || [])}'>
        
        <button type="button" class="btn-remove-slot" onclick="this.parentElement.remove()">✖ Remove</button>
        <div style="display: flex; gap: 10px;">
            <div style="flex: 0 0 100px;"><label style="font-size:12px;">Time</label><input type="time" class="ts-time" value="${slot.time || ''}" required></div>
            <div style="flex: 1;"><label style="font-size:12px;">Heading</label><input type="text" class="ts-heading" value="${slot.heading || ''}" placeholder="Topic heading" required></div>
        </div>
        <label style="font-size:12px; margin-top:5px; display:block;">Description / Text</label>
        <textarea class="ts-desc" rows="2" placeholder="What will you do?">${slot.desc || ''}</textarea>
        <label style="font-size:12px; margin-top:5px; display:block;">Browser Link (Optional)</label>
        <input type="url" class="ts-link" value="${slot.link || ''}" placeholder="https://...">
    `;
    container.appendChild(div);
}

// --- SAVE ENTRY ---
document.getElementById('entryForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('entryId').value;
    const date = document.getElementById('entryDate').value;
    const journal = document.getElementById('journalBody').value.trim();
    
    const slotElements = document.querySelectorAll('.slot-builder');
    let timetable = [];
    
    slotElements.forEach(el => {
        timetable.push({
            id: el.querySelector('.ts-id').value,
            time: el.querySelector('.ts-time').value,
            heading: el.querySelector('.ts-heading').value.trim(),
            desc: el.querySelector('.ts-desc').value.trim(),
            link: el.querySelector('.ts-link').value.trim(),
            status: el.querySelector('.ts-status').value,
            elapsed: parseInt(el.querySelector('.ts-elapsed').value),
            logs: JSON.parse(el.querySelector('.ts-logs').value || '[]')
        });
    });

    const data = { date, journal, timetable };

    if (id) {
        await db.entries.update(parseInt(id), data);
    } else {
        const existing = await db.entries.where('date').equals(date).first();
        if(existing) await db.entries.update(existing.id, data);
        else await db.entries.add(data);
    }
    
    closeForm();
    topToast.fire({ text: 'Day Saved!' });
};

// --- HOME SCREEN LOAD ---
async function loadEntries() {
    const query = document.getElementById('searchInput').value.toLowerCase();
    let entries = await db.entries.orderBy('date').reverse().toArray();
    
    if (query) {
        entries = entries.filter(e => {
            const d = new Date(e.date);
            const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();
            const textToSearch = dateStr + " " + e.journal.toLowerCase() + " " + e.timetable.map(t => t.heading.toLowerCase() + " " + t.desc.toLowerCase()).join(" ");
            return textToSearch.includes(query);
        });
    }
    
    let html = "";
    entries.forEach((entry, idx) => {
        const bg = gradients[idx % gradients.length];
        const d = new Date(entry.date);
        const displayDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        let topicsText = entry.timetable.length ? entry.timetable.map(t => t.heading).join(', ') : 'No topics planned.';
        
        html += `
        <div class="entry-card" style="background: ${bg}" onclick="openDayView(${entry.id})">
            <h3>${displayDate}</h3>
            <p><strong>Topics:</strong> ${topicsText}</p>
        </div>`;
    });

    document.getElementById('entryList').innerHTML = html || "<p style='text-align:center; color:#888;'>No entries found.</p>";
}

document.getElementById('searchInput').oninput = loadEntries;

// --- DAY VIEW & TIMERS ---
async function openDayView(id) {
    const entry = await db.entries.get(id);
    if(!entry) return;
    
    currentOpenedEntryId = id;
    document.getElementById('viewModal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    
    const d = new Date(entry.date);
    document.getElementById('viewTitle').innerText = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    
    // Setup Edit button
    document.getElementById('btnEditDay').onclick = () => {
        document.getElementById('entryId').value = entry.id;
        document.getElementById('entryDate').value = entry.date;
        document.getElementById('journalBody').value = entry.journal || "";
        document.getElementById('timetableContainer').innerHTML = "";
        entry.timetable.forEach(t => addTimeSlot(t));
        document.getElementById('deleteBtn').style.display = 'block';
        openForm(entry.id);
    };

    renderDayViewHTML(entry);
    
    // Start Live Timer Engine
    clearInterval(currentTimerInterval);
    currentTimerInterval = setInterval(() => updateLiveTimers(entry), 1000);
}

function renderDayViewHTML(entry) {
    let html = ``;
    
    if(entry.journal) {
        html += `<div class="section-card" style="margin-bottom: 20px;">
            <h4>📖 Notes</h4>
            <div style="white-space:pre-wrap; font-size:14px; color:#444; margin-top:5px;">${entry.journal}</div>
        </div>`;
    }

    entry.timetable.forEach(slot => {
        let linkHtml = slot.link ? `<a href="${slot.link}" target="_blank" class="view-link">🔗 Open Topic Link</a>` : '';
        
        let timerClass = slot.status === 'active' ? 'timer-active' : (slot.status === 'finished' ? 'timer-finished' : '');
        
        let logsHtml = '';
        if(slot.logs && slot.logs.length > 0) {
            logsHtml = `<div class="timer-logs"><strong>Activity Log:</strong><br>`;
            slot.logs.forEach((log, i) => {
                const timeStr = new Date(log.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                let msg = `• ${log.type.charAt(0).toUpperCase() + log.type.slice(1)} at ${timeStr}`;
                
                // Calculate Idle Time if Started after a Pause
                if(log.type === 'started' && i > 0 && slot.logs[i-1].type === 'paused') {
                    const idleMs = log.time - slot.logs[i-1].time;
                    const idleMins = Math.floor(idleMs / 60000);
                    if(idleMins > 0) msg += ` (Idle for ${idleMins} mins)`;
                }
                logsHtml += `<div class="log-item">${msg}</div>`;
            });
            logsHtml += `</div>`;
        }

        html += `
        <div class="view-topic">
            <p style="font-weight:bold; color:#667eea; margin-bottom:5px;">🕒 ${slot.time}</p>
            <h4>${slot.heading}</h4>
            <p>${slot.desc}</p>
            ${linkHtml}
            
            <div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 15px;">
                <div id="timer_display_${slot.id}" class="timer-display ${timerClass}">00:00:00</div>
                <div class="timer-controls">
                    ${slot.status !== 'finished' ? 
                        `<button style="background:#4CAF50; color:white;" onclick="handleTimer('${slot.id}', 'started')">▶️ Start</button>
                         <button style="background:#FFC107; color:black;" onclick="handleTimer('${slot.id}', 'paused')">⏸️ Pause</button>
                         <button style="background:#F44336; color:white;" onclick="handleTimer('${slot.id}', 'finished')">⏹️ Finish</button>`
                    : `<span style="color:#e65100; font-weight:bold;">✅ Task Finished</span>` }
                </div>
                ${logsHtml}
            </div>
        </div>`;
    });

    document.getElementById('viewBody').innerHTML = html || "<p>No topics scheduled.</p>";
    updateLiveTimers(entry); // Initialize first frame
}

// --- TIMER ENGINE ---
function formatTime(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function updateLiveTimers(entry) {
    entry.timetable.forEach(slot => {
        let displayMs = slot.elapsed || 0;
        
        if (slot.status === 'active' && slot.logs.length > 0) {
            const lastLog = slot.logs[slot.logs.length - 1];
            if (lastLog.type === 'started') {
                displayMs += (Date.now() - lastLog.time);
            }
        }
        
        const el = document.getElementById(`timer_display_${slot.id}`);
        if(el) el.innerText = formatTime(displayMs);
    });
}

window.handleTimer = async (slotId, action) => {
    const entry = await db.entries.get(currentOpenedEntryId);
    const slot = entry.timetable.find(s => s.id === slotId);
    
    // Prevent pausing if not active, etc.
    if(action === 'started' && slot.status === 'active') return;
    if((action === 'paused' || action === 'finished') && slot.status !== 'active' && slot.status !== 'pending') return;

    // If stopping an active timer, calculate elapsed
    if ((action === 'paused' || action === 'finished') && slot.status === 'active') {
        const lastStart = slot.logs[slot.logs.length - 1].time;
        slot.elapsed += (Date.now() - lastStart);
    }

    slot.status = action === 'started' ? 'active' : action;
    if(!slot.logs) slot.logs = [];
    slot.logs.push({ type: action, time: Date.now() });

    await db.entries.put(entry);
    renderDayViewHTML(entry); // Re-render to show updated logs and colors
};

window.deleteCurrentEntry = async () => {
    const id = document.getElementById('entryId').value;
    Swal.fire({ title: 'Delete Day?', showCancelButton: true, confirmButtonText: 'Yes, Delete', confirmButtonColor: '#d32f2f' }).then(async (res) => {
        if(res.isConfirmed) { await db.entries.delete(parseInt(id)); closeForm(); }
    });
};

loadEntries();