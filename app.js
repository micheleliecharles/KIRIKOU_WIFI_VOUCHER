const API_URL = '/api/vouchers';

// Obtenir ou créer une empreinte unique pour l'appareil client
function getDeviceId() {
    let deviceId = localStorage.getItem('kirikou_device_id');
    if (!deviceId) {
        deviceId = 'DEV-' + Math.random().toString(36).substring(2, 11).toUpperCase();
        localStorage.setItem('kirikou_device_id', deviceId);
    }
    return deviceId;
}

let allVouchers = [];

document.addEventListener('DOMContentLoaded', () => {
    loadVouchers();

    document.getElementById('activationForm').addEventListener('submit', handleActivation);
    document.getElementById('generateForm').addEventListener('submit', handleGeneration);
    document.getElementById('searchInput').addEventListener('input', renderTable);
    document.getElementById('statusFilter').addEventListener('change', renderTable);
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCSV);
});

// Activation du code par le client
async function handleActivation(e) {
    e.preventDefault();
    const code = document.getElementById('voucherInput').value.trim();
    const resultDiv = document.getElementById('activationResult');
    const deviceId = getDeviceId();

    resultDiv.textContent = "Vérification en cours...";
    resultDiv.style.color = "#aaa";

    try {
        const res = await fetch(`${API_URL}/activate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, deviceId })
        });

        const data = await res.json();

        if (data.success) {
            resultDiv.style.color = "#2ec4b6";
            resultDiv.textContent = `${data.message} (Expire le : ${new Date(data.expiresAt).toLocaleString()})`;
        } else {
            resultDiv.style.color = "#e63946";
            resultDiv.textContent = data.message;
        }
        loadVouchers();
    } catch (err) {
        resultDiv.style.color = "#e63946";
        resultDiv.textContent = "Erreur de connexion avec le serveur.";
    }
}

// Génération de codes par l'administrateur
async function handleGeneration(e) {
    e.preventDefault();
    const count = document.getElementById('codeCount').value;
    const durationDays = document.getElementById('durationDays').value;

    try {
        const res = await fetch(`${API_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ count, durationDays })
        });
        const data = await res.json();
        if (data.success) {
            alert(`${data.count} code(s) généré(s) avec succès !`);
            loadVouchers();
        }
    } catch (err) {
        alert("Erreur lors de la génération des codes.");
    }
}

// Charger tous les codes depuis le serveur
async function loadVouchers() {
    try {
        const res = await fetch(API_URL);
        const data = await res.json();
        if (data.success) {
            allVouchers = data.vouchers;
            updateStats();
            renderTable();
        }
    } catch (err) {
        console.error("Erreur chargement vouchers:", err);
    }
}

// Mise à jour des statistiques du tableau de bord
function updateStats() {
    document.getElementById('statTotal').textContent = allVouchers.length;
    document.getElementById('statPending').textContent = allVouchers.filter(v => v.status === 'PENDING').length;
    document.getElementById('statActive').textContent = allVouchers.filter(v => v.status === 'ACTIVE').length;
    document.getElementById('statExpired').textContent = allVouchers.filter(v => v.status === 'EXPIRED').length;
    document.getElementById('statBlocked').textContent = allVouchers.filter(v => v.status === 'BLOCKED').length;
}

// Rendu et filtrage du tableau
function renderTable() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const filter = document.getElementById('statusFilter').value;
    const tbody = document.getElementById('voucherTableBody');

    tbody.innerHTML = '';

    const filtered = allVouchers.filter(v => {
        const matchesSearch = v.code.toLowerCase().includes(search) || (v.device_id && v.device_id.toLowerCase().includes(search));
        const matchesFilter = (filter === 'ALL') || (v.status === filter);
        return matchesSearch && matchesFilter;
    });

    filtered.forEach(v => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><b>${v.code}</b> <button class="btn-copy" onclick="copyCode('${v.code}')">📋</button></td>
            <td>${v.duration_days} J</td>
            <td><span class="badge badge-${v.status}">${v.status}</span></td>
            <td>${v.device_id || '-'}</td>
            <td>${v.expires_at ? new Date(v.expires_at).toLocaleString() : '-'}</td>
            <td>
                ${v.status !== 'BLOCKED' ? `<button class="btn btn-danger" onclick="toggleBlock(${v.id}, 'BLOCKED')">Bloquer</button>` : `<button class="btn btn-success" onclick="toggleBlock(${v.id}, 'PENDING')">Débloquer</button>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function copyCode(code) {
    navigator.clipboard.writeText(code);
    alert(`Code ${code} copié !`);
}

async function toggleBlock(id, newStatus) {
    await fetch(`${API_URL}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus })
    });
    loadVouchers();
}

// Exportation CSV
function exportToCSV() {
    let csv = 'ID,Code,Duree_Jours,Statut,Appareil,Date_Expiration\n';
    allVouchers.forEach(v => {
        csv += `"${v.id}","${v.code}","${v.duration_days}","${v.status}","${v.device_id || ''}","${v.expires_at || ''}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Vouchers_KIRIKOU_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
}
