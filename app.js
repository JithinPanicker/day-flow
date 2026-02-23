// --- INIT DB ---
const db = new Dexie('DayFlowDB');
db.version(2).stores({ entries: '++id, date' });

const topToast = Swal.mixin({ toast: true, position: 'top', showConfirmButton: false, timer: 2000, background: '#1DA1F2', color: '#fff' });

// --- GLOBALS ---
let currentTimerInterval = null;
let currentOpenedEntryId = null;
const gradients = ['var(--grad-card-1)', 'var(--grad-card-2)', 'var(--grad-card-3)', 'var(--grad-card-4)'];

// --- DATE HELPER ---
function getLocalISODate() {
    const today = new Date();
    const offset = today.getTimezoneOffset() * 60000;
    return (new Date(today - offset)).toISOString().split('T')[0];
}

// --- TARGET LOGIC (Row by Row) ---
async function loadHomeTarget() {
    const todayStr = getLocalISODate();
    const entry = await db.entries.where('date').equals(todayStr).first();
    const listDiv = document.getElementById('homeTargetsList');
    
    let targets = entry ? (entry.targets || []) : [];
    
    // Fallback migration for old single targets
    if (entry && entry.target && targets.length === 0) {
        targets = [{ id: 'legacy', text: entry.target, status: entry.targetStatus || 'pending' }];
    }

    if(targets.length === 0) {
        listDiv.innerHTML = "<p style='color:#888; font-size:13px; margin:0;'>No targets set yet.</p>";
        return;
    }

    let html = '';
    targets.forEach(t => {
        let strike = t.status === 'failed' ? 'text-decoration: line-through; opacity: 0.7;' : '';
        html += `
        <div class="target-box view-mode">
            <div class="target-text" style="${strike}">${t.text}</div>
            <div class="target-actions">
                <button onclick="toggleTarget(${entry.id}, '${t.id}', 'completed', event)" class="btn-target ${t.status === 'completed' ? 'completed' : ''}">✅</button>
                <button onclick="toggleTarget(${entry.id}, '${t.id}', 'failed', event)" class="btn-target ${t.status === 'failed' ? 'failed' : ''}">❌</button>
                <button onclick="deleteTarget(${entry.id}, '${t.id}', event)" class="btn-target delete-tgt">🗑️</button>
            </div>
        </div>`;
    });
    listDiv.innerHTML = html;
}

window.addHomeTarget = async () => {
    const text = document.getElementById('homeDailyTarget').value.trim();
    if(!text) return;
    
    const todayStr = getLocalISODate();
    let entry = await db.entries.where('date').equals(todayStr).first();
    const newTarget = { id: Date.now().toString(), text: text, status: 'pending' };
    
    if(entry) {
        if(!entry.targets) entry.targets = [];
        entry.targets.push(newTarget);
        await db.entries.put(entry);
    } else {
        await db.entries.add({ date: todayStr, targets: [newTarget], journal: '', timetable: [] });
    }
    
    document.getElementById('homeDailyTarget').value = '';
    loadHomeTarget();
    loadEntries();
};

window.toggleTarget = async (entryId, targetId, status, event) => {
    if(event) event.stopPropagation();
    const entry = await db.entries.get(entryId);
    
    // Migration check
    let targets = entry.targets || [];
    if(entry.target && targets.length === 0) targets = [{ id: 'legacy', text: entry.target, status: entry.targetStatus || 'pending' }];
    
    const target = targets.find(t => t.id === targetId);
    if(target) {
        target.status = target.status === status ? 'pending' : status;
        entry.targets = targets;
        await db.entries.put(entry);
        loadHomeTarget();
        loadEntries();
        if(!document.getElementById('viewModal').classList.contains('hidden') && currentOpenedEntryId === entryId) {
            renderDayViewHTML(entry);
        }
    }
};

window.deleteTarget = async (entryId, targetId, event) => {
    if(event) event.stopPropagation();
    const entry = await db.entries.get(entryId);
    let targets = entry.targets || [];
    if(entry.target && targets.length === 0) targets = [{ id: 'legacy', text: entry.target, status: entry.targetStatus || 'pending' }];
    
    entry.targets = targets.filter(t => t.id !== targetId);
    await db.entries.put(entry);
    loadHomeTarget();
    loadEntries();
    if(!document.getElementById('viewModal').classList.contains('hidden') && currentOpenedEntryId === entryId) {
        renderDayViewHTML(entry);
    }
};

// --- FORM UI HELPERS ---
function openForm(id = null) {
    document.getElementById('formModal').classList.remove('hidden');
    document.getElementById('viewModal').classList.add('hidden');
    document.body.style.overflow = 'hidden';
    
    if(!id) {
        document.getElementById('entryForm').reset();
        document.getElementById('entryId').value = "";
        document.getElementById('entryDate').value = getLocalISODate();
        document.getElementById('timetableContainer').innerHTML = '';
        addTimeSlot();
    }
}

function closeForm() { document.getElementById('formModal').classList.add('hidden'); document.body.style.overflow = 'auto'; loadEntries(); }
function closeView() { document.getElementById('viewModal').classList.add('hidden'); document.body.style.overflow = 'auto'; clearInterval(currentTimerInterval); }

// --- SMART AUTOFILL (Dropdown) ---
window.autofillHeading = async (btnElement) => {
    const selectedDate = document.getElementById('entryDate').value;
    const entry = await db.entries.where('date').equals(selectedDate).first();
    let targets = entry ? (entry.targets || []) : [];
    if(entry && entry.target && targets.length === 0) targets = [{ id: 'legacy', text: entry.target, status: 'pending' }];
    
    if (targets.length === 1) {
        const headingInput = btnElement.closest('.slot-builder').querySelector('.ts-heading');
        headingInput.value = targets[0].text;
    } else if (targets.length > 1) {
        // Multi-select using SweetAlert
        let options = {};
        targets.forEach(t => options[t.id] = t.text);
        
        const { value: targetId } = await Swal.fire({
            title: 'Select a Target',
            input: 'select',
            inputOptions: options,
            inputPlaceholder: 'Choose goal...',
            showCancelButton: true,
            confirmButtonColor: '#4CAF50'
        });
        
        if (targetId) {
            const headingInput = btnElement.closest('.slot-builder').querySelector('.ts-heading');
            headingInput.value = targets.find(t => t.id === targetId).text;
        }
    } else {
        topToast.fire({ text: 'No targets set for this date!', background: '#FF9800' });
    }
};

function addTimeSlot(slot = {}) {
    const container = document.getElementById('timetableContainer');
    const slotId = slot.id || 'slot_' + Date.now() + Math.random().toString(36).substr(2, 5);
    
    const div = document.createElement('div');
    div.className = 'slot-builder';
    div.innerHTML = `
        <input type="hidden" class="ts-id" value="${slotId}">
        <input type="hidden" class="ts-status" value="${slot.status || 'pending'}">
        <input type="hidden" class="ts-logs" value='${JSON.stringify(slot.logs || [])}'>
        
        <button type="button" class="btn-remove-slot" onclick="this.parentElement.remove()">✖ Remove</button>
        <div style="display: flex; gap: 10px;">
            <div style="flex: 0 0 100px;"><label style="font-size:12px;">Start Time</label><input type="time" class="ts-time" value="${slot.time || ''}" required></div>
            <div style="flex: 1;">
                <label style="font-size:12px; display:flex; justify-content:space-between; align-items:center;">
                    Topic Heading 
                    <span style="color:#FF9800; cursor:pointer; font-weight:bold;" onclick="autofillHeading(this)">🎯 Use Target</span>
                </label>
                <input type="text" class="ts-heading" value="${slot.heading || ''}" placeholder="E.g., Math Study" required>
            </div>
        </div>
        <label style="font-size:12px; margin-top:5px; display:block;">Description / Text</label>
        <textarea class="ts-desc" rows="2" placeholder="What exactly will you do?">${slot.desc || ''}</textarea>
        <label style="font-size:12px; margin-top:5px; display:block;">Browser Link (Paste any link)</label>
        <input type="text" class="ts-link" value="${slot.link || ''}" placeholder="google.com or https://...">
    `;
    container.appendChild(div);
}

// --- SAVE ENTRY (Day Plan) ---
document.getElementById('entryForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('entryId').value;
    const date = document.getElementById('entryDate').value;
    const journal = document.getElementById('journalBody').value.trim();
    
    // Preserve targets list
    let existing = await db.entries.where('date').equals(date).first();
    let targets = existing ? (existing.targets || []) : [];
    if(existing && existing.target && targets.length === 0) targets = [{ id: 'legacy', text: existing.target, status: existing.targetStatus || 'pending' }];
    
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
            logs: JSON.parse(el.querySelector('.ts-logs').value || '[]')
        });
    });

    const data = { date, targets, journal, timetable };

    if (id) {
        await db.entries.update(parseInt(id), data);
    } else {
        if(existing) await db.entries.update(existing.id, data);
        else await db.entries.add(data);
    }
    
    closeForm();
    topToast.fire({ text: 'Day Saved!' });
};

// --- DELETE INSTANTLY ---
window.deleteEntry = async (id) => {
    Swal.fire({ title: 'Delete Day?', showCancelButton: true, confirmButtonText: 'Yes, Delete', confirmButtonColor: '#d32f2f' }).then(async (res) => {
        if(res.isConfirmed) { 
            await db.entries.delete(parseInt(id)); 
            closeView(); closeForm(); loadEntries(); 
            topToast.fire({ text: 'Deleted successfully!' });
        }
    });
};

// --- HOME SCREEN LOAD ---
async function loadEntries() {
    loadHomeTarget();
    
    const query = document.getElementById('searchInput').value.toLowerCase();
    let entries = await db.entries.orderBy('date').reverse().toArray();
    
    if (query) {
        entries = entries.filter(e => {
            const d = new Date(e.date);
            const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();
            let tgtString = e.targets ? e.targets.map(t=>t.text.toLowerCase()).join(" ") : ((e.target||"").toLowerCase());
            const textToSearch = dateStr + " " + tgtString + " " + (e.journal||"").toLowerCase() + " " + (e.timetable ? e.timetable.map(t => t.heading.toLowerCase() + " " + t.desc.toLowerCase()).join(" ") : "");
            return textToSearch.includes(query);
        });
    }
    
    let html = "";
    entries.forEach((entry, idx) => {
        let targets = entry.targets || [];
        if(entry.target && targets.length === 0) targets = [{ id: 'legacy', text: entry.target, status: entry.targetStatus || 'pending' }];

        // Hide completely empty logs
        if(targets.length === 0 && (!entry.timetable || entry.timetable.length === 0) && !entry.journal) return;

        const bg = gradients[idx % gradients.length];
        const d = new Date(entry.date);
        const displayDate = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        let topicsText = (entry.timetable && entry.timetable.length) ? entry.timetable.map(t => t.heading).join(', ') : 'No topics planned.';
        
        let targetHtml = '';
        if(targets.length > 0) {
            targetHtml += `<div class="targets-container">`;
            targets.forEach(t => {
                let strike = t.status === 'failed' ? 'text-decoration: line-through; opacity: 0.7;' : '';
                targetHtml += `
                <div class="target-box" onclick="event.stopPropagation()">
                    <div class="target-text" style="${strike}">🎯 ${t.text}</div>
                    <div class="target-actions">
                        <button onclick="toggleTarget(${entry.id}, '${t.id}', 'completed', event)" class="btn-target ${t.status === 'completed' ? 'completed' : ''}">✅</button>
                        <button onclick="toggleTarget(${entry.id}, '${t.id}', 'failed', event)" class="btn-target ${t.status === 'failed' ? 'failed' : ''}">❌</button>
                    </div>
                </div>`;
            });
            targetHtml += `</div>`;
        }
        
        html += `
        <div class="entry-card" style="background: ${bg}" onclick="openDayView(${entry.id})">
            <h3>${displayDate}</h3>
            <p style="margin-bottom: 5px;"><strong>Topics:</strong> ${topicsText}</p>
            ${targetHtml}
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
    
    document.getElementById('btnDeleteDayView').onclick = () => deleteEntry(entry.id);
    
    document.getElementById('btnEditDay').onclick = () => {
        document.getElementById('entryId').value = entry.id;
        document.getElementById('entryDate').value = entry.date;
        document.getElementById('journalBody').value = entry.journal || "";
        document.getElementById('timetableContainer').innerHTML = "";
        if(entry.timetable) entry.timetable.forEach(t => addTimeSlot(t));
        openForm(entry.id);
    };

    renderDayViewHTML(entry);
    clearInterval(currentTimerInterval);
    currentTimerInterval = setInterval(() => updateLiveTimers(entry), 1000);
}

function renderDayViewHTML(entry) {
    let html = ``;
    
    let targets = entry.targets || [];
    if(entry.target && targets.length === 0) targets = [{ id: 'legacy', text: entry.target, status: entry.targetStatus || 'pending' }];

    if(targets.length > 0) {
        html += `<div class="section-card" style="margin-bottom: 20px; border-left: 4px solid #FF9800;">
            <h4 style="margin-bottom:10px;">🎯 Targets</h4>
            <div class="targets-container">`;
        
        targets.forEach(t => {
            let strike = t.status === 'failed' ? 'text-decoration: line-through; opacity: 0.6;' : '';
            html += `
            <div class="target-box view-mode">
                <div class="target-text" style="${strike}">${t.text}</div>
                <div class="target-actions">
                    <button onclick="toggleTarget(${entry.id}, '${t.id}', 'completed', event)" class="btn-target ${t.status === 'completed' ? 'completed' : ''}">✅</button>
                    <button onclick="toggleTarget(${entry.id}, '${t.id}', 'failed', event)" class="btn-target ${t.status === 'failed' ? 'failed' : ''}">❌</button>
                    <button onclick="deleteTarget(${entry.id}, '${t.id}', event)" class="btn-target delete-tgt">🗑️</button>
                </div>
            </div>`;
        });
        html += `</div></div>`;
    }

    if(entry.journal) {
        html += `<div class="section-card" style="margin-bottom: 20px;">
            <h4>📖 Notes</h4>
            <div style="white-space:pre-wrap; font-size:14px; color:#444; margin-top:5px;">${entry.journal}</div>
        </div>`;
    }

    if(entry.timetable) {
        entry.timetable.forEach(slot => {
            let formattedLink = slot.link;
            if(formattedLink && !formattedLink.startsWith('http://') && !formattedLink.startsWith('https://')) formattedLink = 'https://' + formattedLink;
            let linkHtml = formattedLink ? `<a href="${formattedLink}" target="_blank" class="view-link">🔗 Open Topic Link</a>` : '';
            
            let activeClass = slot.status === 'active' ? 'timer-active' : '';
            let idleClass = slot.status === 'paused' ? 'timer-idle' : '';
            
            let logsHtml = '';
            if(slot.logs && slot.logs.length > 0) {
                logsHtml = `<div class="timer-logs"><strong>History:</strong><br>`;
                for(let i = slot.logs.length - 1; i >= 0; i--) {
                    let log = slot.logs[i];
                    const timeStr = new Date(log.time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    let emoji = log.type === 'started' ? '▶️' : (log.type === 'paused' ? '⏸️' : '⏹️');
                    logsHtml += `<div class="log-item">${emoji} ${log.type.toUpperCase()} at ${timeStr}</div>`;
                }
                logsHtml += `</div>`;
            }

            html += `
            <div class="view-topic">
                <p style="font-weight:bold; color:#667eea; margin-bottom:5px;">🕒 ${slot.time}</p>
                <h4>${slot.heading}</h4>
                <p>${slot.desc}</p>
                ${linkHtml}
                
                <div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 15px;">
                    <div class="timer-dashboard">
                        <div class="stat-box active-box ${activeClass}">
                            <span class="stat-label">Active Time</span>
                            <div id="active_display_${slot.id}" class="timer-display">00:00:00</div>
                        </div>
                        <div class="stat-box idle-box ${idleClass}">
                            <span class="stat-label">Idle Time</span>
                            <div id="idle_display_${slot.id}" class="timer-display">00:00:00</div>
                        </div>
                    </div>

                    <div class="timer-controls">
                        ${slot.status !== 'finished' ? 
                            `<button style="background:#4CAF50; color:white;" onclick="handleTimer('${slot.id}', 'started')">▶️ Start/Resume</button>
                             <button style="background:#FFC107; color:black;" onclick="handleTimer('${slot.id}', 'paused')">⏸️ Pause</button>
                             <button style="background:#F44336; color:white;" onclick="handleTimer('${slot.id}', 'finished')">⏹️ Finish</button>`
                        : `<span style="display:inline-block; background:#e8f5e9; color:#2e7d32; padding:8px 15px; border-radius:8px; font-weight:bold;">✅ Task Finished</span>` }
                    </div>
                    ${logsHtml}
                </div>
            </div>`;
        });
    }

    document.getElementById('viewBody').innerHTML = html || "<p>No topics scheduled.</p>";
    updateLiveTimers(entry); 
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
    const now = Date.now();
    if(entry.timetable) {
        entry.timetable.forEach(slot => {
            let activeMs = 0; let idleMs = 0; let lastStart = null; let lastPause = null;
            slot.logs.forEach(log => {
                if (log.type === 'started') {
                    lastStart = log.time;
                    if (lastPause !== null) { idleMs += (log.time - lastPause); lastPause = null; }
                } else if (log.type === 'paused' || log.type === 'finished') {
                    if (lastStart !== null) { activeMs += (log.time - lastStart); lastStart = null; }
                    if (log.type === 'paused') lastPause = log.time;
                }
            });
            if (slot.status === 'active' && lastStart !== null) activeMs += (now - lastStart);
            else if (slot.status === 'paused' && lastPause !== null) idleMs += (now - lastPause);

            const activeEl = document.getElementById(`active_display_${slot.id}`);
            if (activeEl) activeEl.innerText = formatTime(activeMs);
            const idleEl = document.getElementById(`idle_display_${slot.id}`);
            if (idleEl) idleEl.innerText = formatTime(idleMs);
        });
    }
}

window.handleTimer = async (slotId, action) => {
    const entry = await db.entries.get(currentOpenedEntryId);
    const slot = entry.timetable.find(s => s.id === slotId);
    if(action === 'started' && slot.status === 'active') return;
    if(action === 'paused' && slot.status === 'paused') return;
    if((action === 'paused' || action === 'finished') && slot.status === 'pending') return;

    slot.status = action === 'started' ? 'active' : action;
    if(!slot.logs) slot.logs = [];
    slot.logs.push({ type: action, time: Date.now() });

    await db.entries.put(entry);
    renderDayViewHTML(entry);
};

// Start
loadEntries();