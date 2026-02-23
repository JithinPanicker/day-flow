// --- DATABASE SETUP ---
const db = new Dexie('DayFlowDB');
db.version(1).stores({ 
    entries: '++id, date, journal' // date will act as our primary sort key
});

// --- UI ELEMENTS ---
const modal = document.getElementById('entryFormModal');
const form = document.getElementById('entryForm');
const timetableContainer = document.getElementById('timetableContainer');
const searchInput = document.getElementById('searchInput');

// --- TOASTS (From your original design) ---
const topToast = Swal.mixin({
    toast: true, position: 'top', showConfirmButton: false, timer: 2000,
    background: '#1DA1F2', color: '#fff', customClass: { popup: 'x-toast' }
});

const warnToast = Swal.mixin({
    toast: true, position: 'top', showConfirmButton: true, showCancelButton: true,
    confirmButtonColor: '#E0245E', cancelButtonColor: '#657786', confirmButtonText: 'Yes',
    background: '#15202B', color: '#fff', customClass: { popup: 'x-toast-confirm' }
});

// --- TEXTAREA UNDO / CLEAR ---
window.textHistory = {};
window.clearText = (id) => {
    const el = document.getElementById(id);
    if(el) { window.textHistory[id] = el.value; el.value = ''; el.focus(); }
};
window.undoText = (id) => {
    const el = document.getElementById(id);
    if(el && window.textHistory[id] !== undefined) {
        el.value = window.textHistory[id]; delete window.textHistory[id]; el.focus();
    } else { document.execCommand('undo'); }
};

// --- MODAL LOGIC ---
function showForm() { 
    modal.classList.remove('hidden'); 
    document.body.style.overflow = 'hidden'; 
    if(!document.getElementById('entryId').value) {
        document.getElementById('entryDate').valueAsDate = new Date();
        timetableContainer.innerHTML = '';
        addTimeSlot(); // Add one default blank row
    }
}
function closeForm() { 
    modal.classList.add('hidden'); 
    document.body.style.overflow = 'auto'; 
    form.reset(); 
    document.getElementById('entryId').value = ""; 
    document.getElementById('deleteBtn').style.display = 'none';
}

// --- DYNAMIC TIMETABLE LOGIC ---
window.addTimeSlot = (time = "", task = "") => {
    const slotDiv = document.createElement('div');
    slotDiv.className = 'time-slot';
    slotDiv.innerHTML = `
        <input type="time" class="ts-time" value="${time}" required>
        <input type="text" class="ts-task" placeholder="What activity?" value="${task}" required>
        <button type="button" class="btn-remove-slot" onclick="this.parentElement.remove()">✖</button>
    `;
    timetableContainer.appendChild(slotDiv);
};

// --- SAVE ENTRY ---
form.onsubmit = async (event) => {
    event.preventDefault();
    const id = document.getElementById('entryId').value;
    const date = document.getElementById('entryDate').value;
    const journal = document.getElementById('journalBody').value.trim();
    
    // Gather Timetable Data
    const times = document.querySelectorAll('.ts-time');
    const tasks = document.querySelectorAll('.ts-task');
    let timetable = [];
    for(let i=0; i<times.length; i++) {
        if(times[i].value || tasks[i].value) {
            timetable.push({ time: times[i].value, task: tasks[i].value });
        }
    }

    const data = { date, timetable, journal, updated: Date.now() };

    if (id) {
        await db.entries.update(parseInt(id), data);
    } else {
        // Prevent duplicate dates, overwrite if exists or just add new
        const existing = await db.entries.where('date').equals(date).first();
        if(existing) {
            await db.entries.update(existing.id, data);
        } else {
            await db.entries.add(data);
        }
    }
    
    closeForm();
    await loadEntries();
    topToast.fire({ text: 'Day saved successfully! 🎉' });
};

// --- LOAD ENTRIES TO LIST ---
const gradients = ['var(--grad-card-1)', 'var(--grad-card-2)', 'var(--grad-card-3)', 'var(--grad-card-4)'];

async function loadEntries() {
    const query = searchInput.value.toLowerCase();
    let entries = await db.entries.orderBy('date').reverse().toArray();
    
    if (query) {
        entries = entries.filter(e => e.journal.toLowerCase().includes(query) || 
            e.timetable.some(t => t.task.toLowerCase().includes(query)));
    }
    
    let html = "";
    entries.forEach((entry, index) => {
        // Pick a random gradient based on index so it stays consistent per view
        const bg = gradients[index % gradients.length];
        
        // Format Date nicely
        const dateObj = new Date(entry.date);
        const displayDate = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

        html += `
        <div class="entry-card" style="background: ${bg}" onclick="openEntry(${entry.id})">
            <h3>${displayDate}</h3>
            <p>${entry.journal ? entry.journal : entry.timetable.length + ' activities logged today.'}</p>
        </div>`;
    });

    document.getElementById('entryList').innerHTML = html || "<p style='text-align:center; color:#888;'>No entries yet. Start logging! ✨</p>";
}

// --- OPEN SPECIFIC ENTRY ---
window.openEntry = async (id) => {
    const entry = await db.entries.get(id);
    if(!entry) return;
    
    document.getElementById('entryId').value = entry.id;
    document.getElementById('entryDate').value = entry.date;
    document.getElementById('journalBody').value = entry.journal || "";
    document.getElementById('deleteBtn').style.display = 'block';

    timetableContainer.innerHTML = '';
    if(entry.timetable && entry.timetable.length > 0) {
        entry.timetable.forEach(slot => addTimeSlot(slot.time, slot.task));
    } else {
        addTimeSlot();
    }
    
    showForm();
};

// --- DELETE ENTRY ---
window.deleteCurrentEntry = async () => {
    const id = document.getElementById('entryId').value;
    if (!id) return;
    warnToast.fire({ text: 'Delete this day permanently?' }).then(async (result) => {
        if (result.isConfirmed) { 
            await db.entries.delete(parseInt(id)); 
            closeForm(); 
            await loadEntries(); 
            topToast.fire({ text: 'Deleted successfully.', background: '#E0245E' }); 
        }
    });
};

// --- GENERATE PDF REPORT ---
window.generatePDF = async () => {
    const date = document.getElementById('entryDate').value;
    const journal = document.getElementById('journalBody').value;
    
    document.getElementById('pdfDate').innerText = date;
    document.getElementById('pdfJournal').innerText = journal || "No journal notes provided.";

    const times = document.querySelectorAll('.ts-time');
    const tasks = document.querySelectorAll('.ts-task');
    let tableHtml = `<tr><th style="border:1px solid #ddd; padding:8px; background:#f5f5f5; width:30%;">Time</th>
                     <th style="border:1px solid #ddd; padding:8px; background:#f5f5f5;">Activity</th></tr>`;
    
    for(let i=0; i<times.length; i++) {
        if(times[i].value || tasks[i].value) {
            tableHtml += `<tr>
                <td style="border:1px solid #ddd; padding:8px;">${times[i].value}</td>
                <td style="border:1px solid #ddd; padding:8px;">${tasks[i].value}</td>
            </tr>`;
        }
    }
    document.getElementById('pdfTimetable').innerHTML = tableHtml;

    topToast.fire({ text: 'Generating PDF...' });
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const element = document.getElementById('pdfTemplate');
        
        // Briefly make element visible for canvas capture
        element.classList.remove('hidden-print');
        element.style.top = '0'; element.style.left = '0';
        
        const canvas = await html2canvas(element, { scale: 2 });
        const imgData = canvas.toDataURL('image/png');
        const width = pdf.internal.pageSize.getWidth();
        const height = (canvas.height * width) / canvas.width;
        
        pdf.addImage(imgData, 'PNG', 0, 0, width, height);
        pdf.save(`DayFlow_${date}.pdf`);
        
        // Hide element again
        element.style.top = '-9999px'; element.style.left = '-9999px';
        element.classList.add('hidden-print');
        
        topToast.fire({ text: 'PDF Downloaded! 📄' });
    } catch (error) { 
        console.error(error);
        topToast.fire({ text: 'PDF Failed', background: '#E0245E' }); 
    }
};

// --- INIT ---
searchInput.oninput = () => loadEntries();
loadEntries();