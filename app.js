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

// ==========================================
// BACKGROUND AUTO-SAVE DRAFT SYSTEM
// ==========================================
function saveDraft() {
    const homeTarget = document.getElementById('homeDailyTarget');
    if(homeTarget) localStorage.setItem('dayflow_home_target', homeTarget.value);

    const isFormOpen = !document.getElementById('formModal').classList.contains('hidden');
    if (isFormOpen) {
        const slotElements = document.querySelectorAll('.slot-builder');
        let timetable = [];
        slotElements.forEach(el => {
            timetable.push({
                id: el.querySelector('.ts-id').value,
                time: el.querySelector('.ts-time').value,
                heading: el.querySelector('.ts-heading').value,
                desc: el.querySelector('.ts-desc').value,
                link: el.querySelector('.ts-link').value,
                status: el.querySelector('.ts-status').value,
                isPinned: el.querySelector('.ts-pin').checked, 
                unclearNotes: el.querySelector('.ts-unclear').value, 
                logs: JSON.parse(el.querySelector('.ts-logs').value || '[]')
            });
        });

        const draftData = {
            isFormOpen: true,
            id: document.getElementById('entryId').value,
            date: document.getElementById('entryDate').value,
            journal: document.getElementById('journalBody').value,
            timetable: timetable
        };
        localStorage.setItem('dayflow_draft', JSON.stringify(draftData));
    } else {
        localStorage.removeItem('dayflow_draft');
    }
}

function restoreDraft() {
    const savedHomeTarget = localStorage.getItem('dayflow_home_target');
    if (savedHomeTarget) document.getElementById('homeDailyTarget').value = savedHomeTarget;

    const draftJson = localStorage.getItem('dayflow_draft');
    if (draftJson) {
        try {
            const draft = JSON.parse(draftJson);
            if (draft.isFormOpen) {
                document.getElementById('entryId').value = draft.id || "";
                document.getElementById('entryDate').value = draft.date || getLocalISODate();
                document.getElementById('journalBody').value = draft.journal || "";
                
                document.getElementById('timetableContainer').innerHTML = "";
                if (draft.timetable && draft.timetable.length > 0) {
                    draft.timetable.forEach(t => addTimeSlot(t));
                } else {
                    addTimeSlot();
                }

                document.getElementById('formModal').classList.remove('hidden');
                document.getElementById('viewModal').classList.add('hidden');
                document.body.style.overflow = 'hidden';
            }
        } catch(e) { console.error("Could not restore draft", e); }
    }
}

window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveDraft(); });
window.addEventListener('pagehide', saveDraft); 

// ==========================================


// --- DYNAMIC DATE SYNC LOGIC ---
window.syncHomeDate = () => {
    loadHomeTarget();
    loadEntries(); // Will update the dynamic button
};

// --- TARGET LOGIC & REVISIONS ---
async function loadHomeTarget() {
    let dateInput = document.getElementById('homeTargetDate');
    if (!dateInput.value) dateInput.value = getLocalISODate();
    const selectedDate = dateInput.value;

    const entry = await db.entries.where('date').equals(selectedDate).first();
    const listDiv = document.getElementById('homeTargetsList');
    
    let targets = entry ? (entry.targets || []) : [];
    if (entry && entry.target && targets.length === 0) targets = [{ id: 'legacy', text: entry.target, status: entry.targetStatus || 'pending', revisionCount: 0 }];

    if(targets.length === 0) {
        listDiv.innerHTML = "<p style='color:#888; font-size:13px; margin:0;'>No targets set for this date.</p>";
        return;
    }

    let html = '';
    targets.forEach(t => {
        let strike = t.status === 'failed' ? 'text-decoration: line-through; opacity: 0.7;' : '';
        let revCount = t.revisionCount || 0;
        
        html += `
        <div class="target-box view-mode">
            <div style="display:flex; flex-direction:column; flex:1;">
                <div class="target-text" style="${strike}">${t.text}</div>
                <div class="revision-counter">
                    Rev: 
                    <button onclick="updateRevision(${entry.id}, '${t.id}', -1, event)" class="btn-rev">-</button>
                    <span style="font-weight:bold; width:12px; text-align:center;">${revCount}</span>
                    <button onclick="updateRevision(${entry.id}, '${t.id}', 1, event)" class="btn-rev">+</button>
                </div>
            </div>
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
    
    const selectedDate = document.getElementById('homeTargetDate').value || getLocalISODate();
    let entry = await db.entries.where('date').equals(selectedDate).first();
    const newTarget = { id: Date.now().toString(), text: text, status: 'pending', revisionCount: 0 };
    
    if(entry) {
        if(!entry.targets) entry.targets = [];
        entry.targets.push(newTarget);
        await db.entries.put(entry);
    } else {
        await db.entries.add({ date: selectedDate, targets: [newTarget], journal: '', timetable: [] });
    }
    
    document.getElementById('homeDailyTarget').value = '';
    localStorage.removeItem('dayflow_home_target'); 
    loadHomeTarget();
    loadEntries();
};

window.updateRevision = async (entryId, targetId, delta, event) => {
    if(event) event.stopPropagation();
    const entry = await db.entries.get(entryId);
    let targets = entry.targets || [];
    const target = targets.find(t => t.id === targetId);
    
    if(target) {
        target.revisionCount = Math.max(0, (target.revisionCount || 0) + delta); 
        entry.targets = targets;
        await db.entries.put(entry);
        loadHomeTarget();
        loadEntries();
        if(!document.getElementById('viewModal').classList.contains('hidden') && currentOpenedEntryId === entryId) {
            renderDayViewHTML(entry);
        }
    }
};

window.toggleTarget = async (entryId, targetId, status, event) => {
    if(event) event.stopPropagation();
    const entry = await db.entries.get(entryId);
    let targets = entry.targets || [];
    const target = targets.find(t => t.id === targetId);
    if(target) {
        target.status = target.status === status ? 'pending' : status;
        entry.targets = targets;
        await db.entries.put(entry);
        loadHomeTarget();
        loadEntries();
        if(!document.getElementById('viewModal').classList.contains('hidden') && currentOpenedEntryId === entryId) renderDayViewHTML(entry);
    }
};

window.deleteTarget = async (entryId, targetId, event) => {
    if(event) event.stopPropagation();
    const entry = await db.entries.get(entryId);
    let targets = entry.targets || [];
    entry.targets = targets.filter(t => t.id !== targetId);
    await db.entries.put(entry);
    loadHomeTarget();
    loadEntries();
    if(!document.getElementById('viewModal').classList.contains('hidden') && currentOpenedEntryId === entryId) renderDayViewHTML(entry);
};

// --- FORM UI HELPERS & DYNAMIC BUTTON ---
window.openPlanForm = async () => {
    const targetDate = document.getElementById('homeTargetDate').value || getLocalISODate();
    document.getElementById('entryDate').value = targetDate; // Sync form to home screen selection
    
    const existing = await db.entries.where('date').equals(targetDate).first();
    if (existing) editEntry(existing);
    else openForm(null, targetDate);
};

window.loadFormDataForDate = async () => {
    const selectedDate = document.getElementById('entryDate').value;
    if(!selectedDate) return;
    
    const existing = await db.entries.where('date').equals(selectedDate).first();
    if (existing) {
        document.getElementById('entryId').value = existing.id;
        document.getElementById('journalBody').value = existing.journal || "";
        document.getElementById('timetableContainer').innerHTML = "";
        if(existing.timetable && existing.timetable.length > 0) existing.timetable.forEach(t => addTimeSlot(t));
        else addTimeSlot();
    } else {
        // Clear form for a fresh new day
        document.getElementById('entryId').value = "";
        document.getElementById('journalBody').value = "";
        document.getElementById('timetableContainer').innerHTML = "";
        addTimeSlot();
    }
};

window.editEntry = (entry) => {
    document.getElementById('entryId').value = entry.id;
    document.getElementById('entryDate').value = entry.date;
    document.getElementById('journalBody').value = entry.journal || "";
    document.getElementById('timetableContainer').innerHTML = "";
    if(entry.timetable && entry.timetable.length > 0) entry.timetable.forEach(t => addTimeSlot(t));
    else addTimeSlot();
    
    document.getElementById('formModal').classList.remove('hidden');
    document.getElementById('viewModal').classList.add('hidden');
    document.body.style.overflow = 'hidden';
};

function openForm(id = null, specificDate = null) {
    document.getElementById('formModal').classList.remove('hidden');
    document.getElementById('viewModal').classList.add('hidden');
    document.body.style.overflow = 'hidden';
    
    if(!id) {
        document.getElementById('entryForm').reset();
        document.getElementById('entryId').value = "";
        document.getElementById('entryDate').value = specificDate || getLocalISODate();
        document.getElementById('timetableContainer').innerHTML = '';
        addTimeSlot();
    }
}

function closeForm() { 
    document.getElementById('formModal').classList.add('hidden'); 
    document.body.style.overflow = 'auto'; 
    localStorage.removeItem('dayflow_draft'); 
    loadEntries(); 
}

function closeView() { 
    document.getElementById('viewModal').classList.add('hidden'); 
    document.body.style.overflow = 'auto'; 
    clearInterval(currentTimerInterval); 
}

window.autofillHeading = async (btnElement) => {
    const selectedDate = document.getElementById('entryDate').value;
    const entry = await db.entries.where('date').equals(selectedDate).first();
    let targets = entry ? (entry.targets || []) : [];
    if(entry && entry.target && targets.length === 0) targets = [{ id: 'legacy', text: entry.target, status: 'pending' }];
    
    if (targets.length === 1) {
        btnElement.closest('.slot-builder').querySelector('.ts-heading').value = targets[0].text;
    } else if (targets.length > 1) {
        let options = {};
        targets.forEach(t => options[t.id] = t.text);
        const { value: targetId } = await Swal.fire({ title: 'Select a Target', input: 'select', inputOptions: options, inputPlaceholder: 'Choose goal...', showCancelButton: true, confirmButtonColor: '#4CAF50' });
        if (targetId) btnElement.closest('.slot-builder').querySelector('.ts-heading').value = targets.find(t => t.id === targetId).text;
    } else topToast.fire({ text: 'No targets set for this date!', background: '#FF9800' });
};

function addTimeSlot(slot = {}) {
    const container = document.getElementById('timetableContainer');
    const slotId = slot.id || 'slot_' + Date.now() + Math.random().toString(36).substr(2, 5);
    const isPinnedHTML = slot.isPinned ? 'checked' : '';
    
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
                    Topic Heading <span style="color:#FF9800; cursor:pointer; font-weight:bold;" onclick="autofillHeading(this)">🎯 Use Target</span>
                </label>
                <input type="text" class="ts-heading" value="${slot.heading || ''}" placeholder="E.g., Math Study" required>
            </div>
        </div>
        
        <div style="margin-top: 10px;">
            <label style="font-size:12px; font-weight:bold; color:#FF9800; cursor:pointer;">
                <input type="checkbox" class="ts-pin" ${isPinnedHTML}> 📌 Mark as Important
            </label>
        </div>

        <label style="font-size:12px; margin-top:10px; display:block;">Description / Text</label>
        <textarea class="ts-desc" rows="2" placeholder="What exactly will you do?">${slot.desc || ''}</textarea>

        <label style="font-size:12px; margin-top:10px; display:block; color:#d32f2f; font-weight:bold;">⚠️ Unclear Sub-topics (Needs Review)</label>
        <textarea class="ts-unclear" rows="1" placeholder="Note down any confusing parts here...">${slot.unclearNotes || ''}</textarea>

        <label style="font-size:12px; margin-top:10px; display:block;">Browser Link</label>
        <input type="text" class="ts-link" value="${slot.link || ''}" placeholder="google.com or https://...">
    `;
    container.appendChild(div);
}

// --- SAVE ENTRY ---
document.getElementById('entryForm').onsubmit = async (e) => {
    e.preventDefault();
    const id = document.getElementById('entryId').value;
    const date = document.getElementById('entryDate').value;
    const journal = document.getElementById('journalBody').value.trim();
    
    let existing = await db.entries.where('date').equals(date).first();
    let targets = existing ? (existing.targets || []) : [];
    
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
            isPinned: el.querySelector('.ts-pin').checked, 
            unclearNotes: el.querySelector('.ts-unclear').value.trim(), 
            logs: JSON.parse(el.querySelector('.ts-logs').value || '[]')
        });
    });

    const data = { date, targets, journal, timetable };

    if (id) await db.entries.update(parseInt(id), data);
    else { if(existing) await db.entries.update(existing.id, data); else await db.entries.add(data); }
    
    localStorage.removeItem('dayflow_draft');
    closeForm();
    topToast.fire({ text: 'Day Saved!' });
};

window.deleteEntry = async (id) => {
    Swal.fire({ title: 'Delete Day?', showCancelButton: true, confirmButtonText: 'Yes, Delete', confirmButtonColor: '#d32f2f' }).then(async (res) => {
        if(res.isConfirmed) { await db.entries.delete(parseInt(id)); closeView(); closeForm(); loadEntries(); topToast.fire({ text: 'Deleted!' }); }
    });
};

// --- HOME SCREEN LOAD & SORTING ---
async function loadEntries() {
    // Ensures target picker defaults to today on first load
    let dateInput = document.getElementById('homeTargetDate');
    if (!dateInput.value) dateInput.value = getLocalISODate();
    
    loadHomeTarget();
    
    const query = document.getElementById('searchInput').value.toLowerCase();
    
    // Sorts the timeline: Future dates at top, Past dates at bottom
    let entries = await db.entries.orderBy('date').reverse().toArray();

    // DYNAMIC BUTTON TEXT UPDATE
    const targetDate = document.getElementById('homeTargetDate').value;
    const currentEntry = entries.find(e => e.date === targetDate);
    const btnPlan = document.getElementById('btnPlanToday');
    
    if (btnPlan) {
        const dObj = new Date(targetDate);
        const shortDate = dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        if (currentEntry && ((currentEntry.timetable && currentEntry.timetable.length > 0) || currentEntry.journal)) {
            btnPlan.innerHTML = `📝 Edit Plan (${shortDate})`;
            btnPlan.style.background = "linear-gradient(135deg, #FF9800 0%, #F44336 100%)";
            btnPlan.style.boxShadow = "0 4px 15px rgba(244, 67, 54, 0.3)";
        } else {
            btnPlan.innerHTML = `📝 Plan Day (${shortDate})`;
            btnPlan.style.background = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
            btnPlan.style.boxShadow = "0 4px 15px rgba(118, 75, 162, 0.3)";
        }
    }
    
    if (query) {
        entries = entries.filter(e => {
            const d = new Date(e.date);
            const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toLowerCase();
            let tgtString = e.targets ? e.targets.map(t=>t.text.toLowerCase()).join(" ") : "";
            const textToSearch = dateStr + " " + tgtString + " " + (e.journal||"").toLowerCase() + " " + (e.timetable ? e.timetable.map(t => t.heading.toLowerCase() + " " + t.desc.toLowerCase() + " " + (t.unclearNotes||"").toLowerCase()).join(" ") : "");
            return textToSearch.includes(query);
        });
    }
    
    let html = "";
    entries.forEach((entry, idx) => {
        let targets = entry.targets || [];
        if(targets.length === 0 && (!entry.timetable || entry.timetable.length === 0) && !entry.journal) return;

        const bg = gradients[idx % gradients.length];
        const displayDate = new Date(entry.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
        
        let topicsText = (entry.timetable && entry.timetable.length) ? entry.timetable.map(t => (t.isPinned ? "📌 " : "") + t.heading).join(', ') : 'No topics planned.';
        
        let targetHtml = '';
        if(targets.length > 0) {
            targetHtml += `<div class="targets-container">`;
            targets.forEach(t => {
                let strike = t.status === 'failed' ? 'text-decoration: line-through; opacity: 0.7;' : '';
                targetHtml += `
                <div class="target-box" onclick="event.stopPropagation()">
                    <div style="display:flex; flex-direction:column; flex:1;">
                        <div class="target-text" style="${strike}">${t.text}</div>
                        <div class="revision-counter" style="color:#555;">Rev: <strong>${t.revisionCount || 0}</strong></div>
                    </div>
                    <div class="target-actions">
                        <button onclick="toggleTarget(${entry.id}, '${t.id}', 'completed', event)" class="btn-target ${t.status === 'completed' ? 'completed' : ''}">✅</button>
                        <button onclick="toggleTarget(${entry.id}, '${t.id}', 'failed', event)" class="btn-target ${t.status === 'failed' ? 'failed' : ''}">❌</button>
                    </div>
                </div>`;
            });
            targetHtml += `</div>`;
        }
        
        html += `<div class="entry-card" style="background: ${bg}" onclick="openDayView(${entry.id})">
            <h3>${displayDate}</h3><p style="margin-bottom: 5px;"><strong>Topics:</strong> ${topicsText}</p>${targetHtml}
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
    document.getElementById('viewTitle').innerText = new Date(entry.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    document.getElementById('btnDeleteDayView').onclick = () => deleteEntry(entry.id);
    document.getElementById('btnEditDay').onclick = () => { editEntry(entry); };

    renderDayViewHTML(entry);
    clearInterval(currentTimerInterval);
    currentTimerInterval = setInterval(() => updateLiveTimers(entry), 1000);
}

function renderDayViewHTML(entry) {
    let html = ``;
    let targets = entry.targets || [];

    if(targets.length > 0) {
        html += `<div class="section-card" style="margin-bottom: 20px; border-left: 4px solid #FF9800;">
            <h4 style="margin-bottom:10px;">🎯 Targets</h4><div class="targets-container">`;
        targets.forEach(t => {
            let strike = t.status === 'failed' ? 'text-decoration: line-through; opacity: 0.6;' : '';
            html += `
            <div class="target-box view-mode">
                <div style="display:flex; flex-direction:column; flex:1;">
                    <div class="target-text" style="${strike}">${t.text}</div>
                    <div class="revision-counter">
                        Rev: 
                        <button onclick="updateRevision(${entry.id}, '${t.id}', -1, event)" class="btn-rev">-</button>
                        <span style="font-weight:bold; width:12px; text-align:center;">${t.revisionCount || 0}</span>
                        <button onclick="updateRevision(${entry.id}, '${t.id}', 1, event)" class="btn-rev">+</button>
                    </div>
                </div>
                <div class="target-actions">
                    <button onclick="toggleTarget(${entry.id}, '${t.id}', 'completed', event)" class="btn-target ${t.status === 'completed' ? 'completed' : ''}">✅</button>
                    <button onclick="toggleTarget(${entry.id}, '${t.id}', 'failed', event)" class="btn-target ${t.status === 'failed' ? 'failed' : ''}">❌</button>
                    <button onclick="deleteTarget(${entry.id}, '${t.id}', event)" class="btn-target delete-tgt">🗑️</button>
                </div>
            </div>`;
        });
        html += `</div></div>`;
    }

    if(entry.journal) html += `<div class="section-card" style="margin-bottom: 20px;"><h4>📖 Notes</h4><div style="white-space:pre-wrap; font-size:14px; color:#444; margin-top:5px;">${entry.journal}</div></div>`;

    if(entry.timetable) {
        entry.timetable.forEach(slot => {
            let formattedLink = slot.link;
            if(formattedLink && !formattedLink.startsWith('http')) formattedLink = 'https://' + formattedLink;
            let linkHtml = formattedLink ? `<a href="${formattedLink}" target="_blank" class="view-link">🔗 Open Topic Link</a>` : '';
            
            // RENDERING THE PIN BADGE & UNCLEAR HIGHLIGHT
            let pinnedClass = slot.isPinned ? 'pinned-topic' : '';
            let pinBadge = slot.isPinned ? '<span style="background:#FFC107; color:#000; font-size:10px; padding:2px 6px; border-radius:10px; vertical-align:middle; margin-left:5px;">📌 PINNED</span>' : '';
            let unclearHtml = slot.unclearNotes ? `<div class="unclear-box"><strong>⚠️ Needs Review:</strong> ${slot.unclearNotes}</div>` : '';

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
            <div class="view-topic ${pinnedClass}">
                <p style="font-weight:bold; color:#667eea; margin-bottom:5px;">🕒 ${slot.time}</p>
                <h4>${slot.heading} ${pinBadge}</h4>
                <p>${slot.desc}</p>
                ${unclearHtml}
                ${linkHtml}
                
                <div style="margin-top: 10px; border-top: 1px solid #eee; padding-top: 15px;">
                    <div class="timer-dashboard">
                        <div class="stat-box active-box ${slot.status === 'active' ? 'timer-active' : ''}"><span class="stat-label">Active Time</span><div id="active_display_${slot.id}" class="timer-display">00:00:00</div></div>
                        <div class="stat-box idle-box ${slot.status === 'paused' ? 'timer-idle' : ''}"><span class="stat-label">Idle Time</span><div id="idle_display_${slot.id}" class="timer-display">00:00:00</div></div>
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
                if (log.type === 'started') { lastStart = log.time; if (lastPause !== null) { idleMs += (log.time - lastPause); lastPause = null; } } 
                else if (log.type === 'paused' || log.type === 'finished') { if (lastStart !== null) { activeMs += (log.time - lastStart); lastStart = null; } if (log.type === 'paused') lastPause = log.time; }
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

// Start App sequence
window.onload = () => { loadEntries().then(() => restoreDraft()); };