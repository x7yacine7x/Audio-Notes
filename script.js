// Supabase configuration
const SUPABASE_URL = 'https://umwtaqtijwjfdugtefql.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtd3RhcXRpandqZmR1Z3RlZnFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkxODAxMDYsImV4cCI6MjA3NDc1NjEwNn0.w3zBFwypwk8rOZhtOkdFC1DH7S9qOaD98q1QnsQdTIo';

// Initialize Supabase client
let supabase;
let cloudFiles = [];
let cloudFolders = new Set();
let currentCloudFolder = '';

// Global variables
let currentAudio = null;
let notes = [];
let currentFileName = '';
let folderStructure = {};
let currentFolderName = '';
let allFiles = [];
let folderOrder = [];
let isCloudConnected = false;

// Profile variables
let currentProfileId = null;
let profiles = [];

// Initialize app
document.addEventListener('DOMContentLoaded', function () {
    loadTheme();
    setupEventListeners();
    initializeSupabase();
});

async function initializeSupabase() {
    try {
        supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        // Test connection
        const { data, error } = await supabase.storage.listBuckets();

        if (error) {
            throw error;
        }

        isCloudConnected = true;
        updateCloudStatus('connected', 'Cloud Connected');
        await refreshCloudFiles();
        await loadProfiles();

    } catch (error) {
        console.error('Supabase initialization error:', error);
        isCloudConnected = false;
        updateCloudStatus('disconnected', 'Cloud Disconnected');
    }
}

// Profile Management Functions
async function loadProfiles() {
    if (!isCloudConnected) return;

    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: true });

        if (error) throw error;

        profiles = data || [];
        renderProfileSelect();

        // Load last used profile
        const lastProfileId = localStorage.getItem('lastProfileId');
        if (lastProfileId && profiles.find(p => p.id === lastProfileId)) {
            currentProfileId = lastProfileId;
            document.getElementById('profileSelect').value = lastProfileId;
            if (currentFileName) {
                await loadNotesForProfile();
            }
        }
    } catch (error) {
        console.error('Error loading profiles:', error);
        showCloudStatus('error', 'Failed to load profiles');
    }
}

function renderProfileSelect() {
    const select = document.getElementById('profileSelect');
    const currentValue = select.value;

    select.innerHTML = '<option value="">Select Profile...</option>' +
        profiles.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

    if (currentValue) {
        select.value = currentValue;
    }
}

async function switchProfile() {
    const select = document.getElementById('profileSelect');
    currentProfileId = select.value || null;

    if (currentProfileId) {
        localStorage.setItem('lastProfileId', currentProfileId);
        await loadNotesForProfile();
    } else {
        localStorage.removeItem('lastProfileId');
        notes = [];
        renderNotes();
    }
}

async function loadNotesForProfile() {
    if (!currentProfileId || !currentFileName) {
        notes = [];
        renderNotes();
        return;
    }

    try {
        const { data, error } = await supabase
            .from('notes')
            .select('*')
            .eq('profile_id', currentProfileId)
            .eq('file_name', currentFileName)
            .order('timestamp', { ascending: true });

        if (error) throw error;

        notes = (data || []).map(note => ({
            id: note.id,
            timestamp: note.timestamp,
            timeString: note.time_string,
            text: note.text,
            fileName: note.file_name,
            createdAt: note.created_at
        }));

        renderNotes();
    } catch (error) {
        console.error('Error loading notes:', error);
        notes = [];
        renderNotes();
    }
}

function openProfileManager() {
    document.getElementById('profileModal').style.display = 'flex';
    renderProfilesList();
}

function closeProfileManager() {
    document.getElementById('profileModal').style.display = 'none';
}

function renderProfilesList() {
    const list = document.getElementById('profilesList');

    if (profiles.length === 0) {
        list.innerHTML = '<div class="empty-state">No profiles yet</div>';
        return;
    }

    list.innerHTML = profiles.map(profile => `
        <div class="profile-list-item">
            <div>
                <strong>${escapeHtml(profile.name)}</strong>
                <div style="font-size: 12px; color: var(--text-secondary);">
                    Created: ${new Date(profile.created_at).toLocaleDateString()}
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button class="btn-icon" onclick="deleteProfile('${profile.id}')" title="Delete">🗑️</button>
            </div>
        </div>
    `).join('');
}

async function createProfile() {
    const input = document.getElementById('newProfileName');
    const name = input.value.trim();

    if (!name) {
        alert('Please enter a profile name');
        return;
    }

    if (!isCloudConnected) {
        alert('Not connected to cloud storage');
        return;
    }

    try {
        const { data, error } = await supabase
            .from('profiles')
            .insert([{ name }])
            .select()
            .single();

        if (error) throw error;

        profiles.push(data);
        renderProfileSelect();
        renderProfilesList();

        input.value = '';
        alert('Profile created successfully!');
    } catch (error) {
        console.error('Error creating profile:', error);
        alert('Failed to create profile: ' + error.message);
    }
}

async function deleteProfile(profileId) {
    if (!confirm('Delete this profile and all its notes? This cannot be undone.')) {
        return;
    }

    try {
        const { error } = await supabase
            .from('profiles')
            .delete()
            .eq('id', profileId);

        if (error) throw error;

        profiles = profiles.filter(p => p.id !== profileId);

        if (currentProfileId === profileId) {
            currentProfileId = null;
            document.getElementById('profileSelect').value = '';
            localStorage.removeItem('lastProfileId');
            notes = [];
            renderNotes();
        }

        renderProfileSelect();
        renderProfilesList();

        alert('Profile deleted successfully!');
    } catch (error) {
        console.error('Error deleting profile:', error);
        alert('Failed to delete profile: ' + error.message);
    }
}

// Cloud Status Functions
function updateCloudStatus(status, text) {
    const indicator = document.getElementById('cloudIndicator');
    const statusText = document.getElementById('cloudStatusText');

    indicator.className = `cloud-indicator ${status === 'connected' ? '' : 'disconnected'}`;
    statusText.textContent = text;
}

async function refreshCloudFiles() {
    let isRefreshing = false;
    if (isRefreshing || !isCloudConnected) {
        if (isRefreshing) {
            showCloudStatus('info', 'Already refreshing...');
        }
        return;
    }

    isRefreshing = true;

    if (!isCloudConnected) {
        showCloudStatus('error', 'Not connected to cloud storage');
        return;
    }

    try {
        showCloudStatus('info', 'Loading cloud files...');

        const { data, error } = await supabase.storage
            .from('audio-files')
            .list('', {
                limit: 1000,
                offset: 0,
                sortBy: { column: 'name', order: 'asc' }
            });

        if (error) {
            throw error;
        }

        cloudFiles = [];
        cloudFolders.clear();

        await processCloudFiles(data, '');

        renderCloudFolderTree();
        renderCloudFiles();
        showCloudStatus('success', `Found ${cloudFiles.length} cloud files in ${cloudFolders.size} folders`);

        setTimeout(() => hideCloudStatus(), 3000);

    } catch (error) {
        console.error('Error loading cloud files:', error);
        showCloudStatus('error', 'Failed to load cloud files: ' + error.message);
        cloudFiles = [];
        cloudFolders.clear();
        renderCloudFolderTree();
        renderCloudFiles();
    } finally {
        isRefreshing = false;
    }
}

async function processCloudFiles(items, currentPath) {
    for (const item of items) {
        const fullPath = currentPath ? `${currentPath}/${item.name}` : item.name;

        if (item.metadata && item.metadata.mimetype) {
            if (item.metadata.mimetype.startsWith('audio/')) {
                cloudFiles.push({
                    ...item,
                    fullPath: fullPath,
                    folder: currentPath
                });
            }
        } else {
            if (item.name && !item.name.includes('.')) {
                cloudFolders.add(fullPath);

                try {
                    const { data: subItems, error } = await supabase.storage
                        .from('audio-files')
                        .list(fullPath, {
                            limit: 1000,
                            offset: 0,
                            sortBy: { column: 'name', order: 'asc' }
                        });

                    if (!error && subItems) {
                        await processCloudFiles(subItems, fullPath);
                    }
                } catch (subError) {
                    console.warn(`Error listing folder ${fullPath}:`, subError);
                }
            }
        }
    }
}

function renderCloudFolderTree() {
    const folderTree = document.getElementById('cloudFolderTree');

    if (cloudFolders.size === 0) {
        folderTree.innerHTML = '<div class="empty-state">No folders found</div>';
        return;
    }

    const sortedFolders = Array.from(cloudFolders).sort();

    folderTree.innerHTML = `
        <div class="cloud-folder-item ${currentCloudFolder === '' ? 'active' : ''}" onclick="navigateToCloudFolder('')">
            <span class="cloud-folder-icon">🏠</span>
            <span class="cloud-folder-name">Root</span>
        </div>
        ${sortedFolders.map(folder => `
            <div class="cloud-folder-item ${currentCloudFolder === folder ? 'active' : ''}" onclick="navigateToCloudFolder('${escapeHtml(folder).replace(/'/g, '\\\'')}')" title="${escapeHtml(folder)}">
                <span class="cloud-folder-icon">📁</span>
                <span class="cloud-folder-name">${escapeHtml(folder.split('/').pop())}</span>
            </div>
        `).join('')}
    `;
}

function navigateToCloudFolder(folderPath) {
    currentCloudFolder = folderPath;
    renderCloudFolderTree();
    renderCloudFiles();
    updateCloudBreadcrumb();
}

function updateCloudBreadcrumb() {
    const breadcrumb = document.getElementById('cloudBreadcrumb');

    if (!currentCloudFolder) {
        breadcrumb.style.display = 'none';
        return;
    }

    breadcrumb.style.display = 'flex';
    const pathParts = currentCloudFolder.split('/');
    let breadcrumbHTML = '<span class="breadcrumb-item" onclick="navigateToCloudFolder(\'\')">🏠 Root</span>';

    let currentPath = '';
    pathParts.forEach((part, index) => {
        currentPath += (currentPath ? '/' : '') + part;
        breadcrumbHTML += `
            <span class="breadcrumb-separator">›</span>
            <span class="breadcrumb-item" onclick="navigateToCloudFolder('${escapeHtml(currentPath).replace(/'/g, '\\\'')}')">${escapeHtml(part)}</span>
        `;
    });

    breadcrumb.innerHTML = breadcrumbHTML;
}

function renderCloudFiles() {
    const cloudFilesList = document.getElementById('cloudFilesList');

    const filteredFiles = cloudFiles.filter(file => file.folder === currentCloudFolder);

    if (filteredFiles.length === 0) {
        cloudFilesList.innerHTML = '<div class="empty-state">No files in this folder</div>';
        return;
    }

    cloudFilesList.innerHTML = filteredFiles.map(file => `
        <div class="cloud-file-item">
            <div class="cloud-file-info">
                <div class="cloud-file-name">${escapeHtml(file.name)}</div>
                <div class="cloud-file-meta">
                    ${formatFileSize(file.metadata?.size || 0)} • 
                    ${new Date(file.updated_at || file.created_at).toLocaleDateString()}
                </div>
            </div>
            <div class="cloud-file-actions">
                <button class="btn-icon" onclick="loadCloudFile('${escapeHtml(file.fullPath).replace(/'/g, '\\\'')}')" title="Load">▶️</button>
                <button class="btn-icon" onclick="downloadCloudFile('${escapeHtml(file.fullPath).replace(/'/g, '\\\'')}')" title="Download">⬇️</button>
                <button class="btn-icon" onclick="deleteCloudFile('${escapeHtml(file.fullPath).replace(/'/g, '\\\'')}')" title="Delete">🗑️</button>
            </div>
        </div>
    `).join('');
}

async function loadCloudFile(filePath) {
    if (!isCloudConnected) {
        alert('Not connected to cloud storage');
        return;
    }

    try {
        showCloudStatus('info', 'Loading cloud file...');

        const { data, error } = await supabase.storage
            .from('audio-files')
            .download(filePath);

        if (error) {
            throw error;
        }

        const fileName = filePath.split('/').pop();
        const file = new File([data], fileName, { type: data.type });

        allFiles = [file];
        folderOrder = [];
        folderStructure = {};
        currentFolderName = '';

        loadAudioFile(file);
        updateFolderDisplay();

        showCloudStatus('success', 'Cloud file loaded successfully');
        setTimeout(() => hideCloudStatus(), 3000);

    } catch (error) {
        console.error('Error loading cloud file:', error);
        showCloudStatus('error', 'Failed to load cloud file: ' + error.message);
    }
}

async function downloadCloudFile(filePath) {
    if (!isCloudConnected) {
        alert('Not connected to cloud storage');
        return;
    }

    try {
        showCloudStatus('info', 'Downloading file...');

        const { data, error } = await supabase.storage
            .from('audio-files')
            .download(filePath);

        if (error) {
            throw error;
        }

        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath.split('/').pop();
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showCloudStatus('success', 'File downloaded successfully');
        setTimeout(() => hideCloudStatus(), 3000);

    } catch (error) {
        console.error('Error downloading cloud file:', error);
        showCloudStatus('error', 'Failed to download file: ' + error.message);
    }
}

async function deleteCloudFile(filePath) {
    if (!isCloudConnected) {
        alert('Not connected to cloud storage');
        return;
    }

    if (!confirm(`Are you sure you want to delete "${filePath}" from cloud storage?`)) {
        return;
    }

    try {
        showCloudStatus('info', 'Deleting file...');

        const { error } = await supabase.storage
            .from('audio-files')
            .remove([filePath]);

        if (error) {
            throw error;
        }

        await refreshCloudFiles();
        showCloudStatus('success', 'File deleted successfully');
        setTimeout(() => hideCloudStatus(), 3000);

    } catch (error) {
        console.error('Error deleting cloud file:', error);
        showCloudStatus('error', 'Failed to delete file: ' + error.message);
    }
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function showCloudStatus(type, message) {
    const statusDiv = document.getElementById('cloudStatusMessage');
    statusDiv.className = `status-message status-${type}`;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
}

function hideCloudStatus() {
    const statusDiv = document.getElementById('cloudStatusMessage');
    statusDiv.style.display = 'none';
}

function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// File Management Functions
function getFileIndex(file) {
    return allFiles.findIndex(f => f.name === file.name && f.size === file.size);
}

function selectFile(index, folderPath) {
    if (index >= 0 && index < allFiles.length) {
        if (folderPath) {
            moveToTop(folderPath);
        }
        loadAudioFile(allFiles[index]);

        setTimeout(() => {
            if (folderPath) {
                const folderId = `folder-${folderPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
                const folderElement = document.getElementById(folderId);
                if (folderElement) {
                    const folderSection = folderElement.parentElement;
                    folderSection.classList.remove('collapsed');
                }
            }
        }, 100);
    }
}

function moveToTop(folderPath) {
    if (!folderPath) return;

    const currentIndex = folderOrder.indexOf(folderPath);
    if (currentIndex > -1) {
        folderOrder.splice(currentIndex, 1);
    }

    folderOrder.unshift(folderPath);
    updateFolderDisplay();
}

function setupEventListeners() {
    const audioFile = document.getElementById('audioFile');
    const folderInput = document.getElementById('folderInput');
    const audioPlayer = document.getElementById('audioPlayer');
    const importFile = document.getElementById('importFile');
    const importAllDataFile = document.getElementById('importAllDataFile');
    const cloudAudioFile = document.getElementById('cloudAudioFile');
    const cloudFolderInput = document.getElementById('cloudFolderInput');

    audioFile.addEventListener('change', handleSingleFileSelect);
    folderInput.addEventListener('change', handleFolderSelect);
    importFile.addEventListener('change', handleImportFile);
    importAllDataFile.addEventListener('change', handleImportAllData);
    cloudAudioFile.addEventListener('change', handleCloudUpload);
    cloudFolderInput.addEventListener('change', handleCloudFolderUpload);

    audioPlayer.addEventListener('timeupdate', updateTimeDisplay);
    audioPlayer.addEventListener('play', updateStatus);
    audioPlayer.addEventListener('pause', updateStatus);
    audioPlayer.addEventListener('ended', updateStatus);
    audioPlayer.addEventListener('loadstart', updateStatus);
    audioPlayer.addEventListener('loadedmetadata', updateTimeDisplay);
    audioPlayer.addEventListener('durationchange', updateTimeDisplay);
}

async function handleCloudUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    if (!isCloudConnected) {
        alert('Not connected to cloud storage');
        event.target.value = '';
        return;
    }

    const uploadProgressDiv = document.getElementById('uploadProgress');
    uploadProgressDiv.style.display = 'block';
    uploadProgressDiv.innerHTML = '';

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        await uploadFileToCloud(file, i + 1, files.length, '');
    }

    event.target.value = '';
    await refreshCloudFiles();
}

async function handleCloudFolderUpload(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    if (!isCloudConnected) {
        alert('Not connected to cloud storage');
        event.target.value = '';
        return;
    }

    const audioFiles = files.filter(file => file.type.startsWith('audio/'));

    if (audioFiles.length === 0) {
        alert('No audio files found in the selected folder.');
        event.target.value = '';
        return;
    }

    const uploadProgressDiv = document.getElementById('uploadProgress');
    uploadProgressDiv.style.display = 'block';
    uploadProgressDiv.innerHTML = '';

    for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const relativePath = file.webkitRelativePath || file.name;
        await uploadFileToCloud(file, i + 1, audioFiles.length, relativePath);
    }

    event.target.value = '';
    await refreshCloudFiles();
}

async function uploadFileToCloud(file, index, total, relativePath) {
    const uploadProgressDiv = document.getElementById('uploadProgress');

    const uploadItem = document.createElement('div');
    uploadItem.className = 'upload-item';
    uploadItem.innerHTML = `
        <div class="upload-info">
            <div class="upload-name">${escapeHtml(relativePath || file.name)}</div>
            <div class="upload-status">Uploading... (${index}/${total})</div>
        </div>
        <div class="progress-bar" style="width: 200px;">
            <div class="progress-fill" style="width: 0%;"></div>
        </div>
    `;
    uploadProgressDiv.appendChild(uploadItem);

    const progressFill = uploadItem.querySelector('.progress-fill');
    const statusDiv = uploadItem.querySelector('.upload-status');

    try {
        const fileName = relativePath || file.name;

        progressFill.style.width = '10%';
        statusDiv.textContent = 'Preparing upload...';

        const { data, error } = await supabase.storage
            .from('audio-files')
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: false
            });

        if (error) {
            throw error;
        }

        progressFill.style.width = '100%';
        statusDiv.textContent = 'Upload completed!';
        uploadItem.style.borderColor = 'var(--success-color)';

    } catch (error) {
        console.error('Upload error:', error);
        progressFill.style.width = '100%';
        progressFill.style.background = 'var(--danger-color)';
        statusDiv.textContent = 'Upload failed: ' + error.message;
        uploadItem.style.borderColor = 'var(--danger-color)';
    }
}

function handleSingleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        allFiles = [file];
        folderOrder = [];
        folderStructure = {};
        currentFolderName = '';

        loadAudioFile(file);
        updateFolderDisplay();
    }
}

function handleFolderSelect(event) {
    const files = Array.from(event.target.files);
    const audioFiles = files.filter(file => file.type.startsWith('audio/'));

    if (audioFiles.length === 0) {
        alert('No audio files found in the selected folder.');
        return;
    }

    allFiles = audioFiles;
    folderStructure = buildFolderStructure(audioFiles);
    const rootFolders = Object.keys(folderStructure);
    currentFolderName = rootFolders.length > 0 ? rootFolders[0] : 'Selected Folder';

    updateFolderDisplay();

    const firstFile = getFirstAudioFile(folderStructure);
    if (firstFile) {
        loadAudioFile(firstFile);
    }
}

function buildFolderStructure(files) {
    const structure = {};
    folderOrder = [];

    files.forEach(file => {
        const pathParts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name];

        if (pathParts.length === 1) {
            const rootFolder = 'Root';
            if (!structure[rootFolder]) {
                structure[rootFolder] = { _files: [] };
            }
            structure[rootFolder]._files.push(file);

            if (!folderOrder.includes('Root')) {
                folderOrder.push('Root');
            }
            return;
        }

        const rootFolder = pathParts[0];
        if (!structure[rootFolder]) {
            structure[rootFolder] = {};
        }

        let current = structure[rootFolder];
        let currentPath = rootFolder;

        for (let i = 1; i < pathParts.length - 1; i++) {
            const folderName = pathParts[i];
            currentPath += '/' + folderName;

            if (!current[folderName]) {
                current[folderName] = {};
            }
            current = current[folderName];
        }

        const fileName = pathParts[pathParts.length - 1];
        if (!current._files) {
            current._files = [];
        }
        current._files.push(file);

        const fullPath = pathParts.slice(0, -1).join('/');
        if (!folderOrder.includes(fullPath)) {
            folderOrder.push(fullPath);
        }
    });

    return structure;
}

function getFirstAudioFile(structure) {
    for (const key in structure) {
        if (key === '_files' && structure[key] && structure[key].length > 0) {
            return structure[key][0];
        } else if (typeof structure[key] === 'object') {
            const file = getFirstAudioFile(structure[key]);
            if (file) return file;
        }
    }
    return null;
}

function updateFolderDisplay() {
    const folderDiv = document.getElementById('currentFolder');
    const folderName = document.getElementById('folderName');
    const folderStructureDiv = document.getElementById('folderStructure');

    if (Object.keys(folderStructure).length > 0) {
        folderDiv.style.display = 'block';
        folderName.textContent = currentFolderName;

        folderStructureDiv.innerHTML = '';
        renderFolderStructure(folderStructure, folderStructureDiv);
    } else {
        folderDiv.style.display = 'none';
        folderStructureDiv.innerHTML = '';
    }
}

function renderFolderStructure(structure, container, path = '') {
    const folderData = [];

    function collectFolders(struct, currentPath) {
        for (const key in struct) {
            if (key === '_files') {
                const files = struct[key];
                if (files && files.length > 0) {
                    const displayPath = currentPath || 'Root';
                    const fullPath = currentPath;
                    folderData.push({
                        path: displayPath,
                        fullPath: fullPath,
                        files: files,
                        order: folderOrder.indexOf(fullPath)
                    });
                }
            } else {
                const subPath = currentPath ? `${currentPath}/${key}` : key;
                collectFolders(struct[key], subPath);
            }
        }
    }

    collectFolders(structure, path);

    folderData.sort((a, b) => {
        const orderA = a.order === -1 ? Infinity : a.order;
        const orderB = b.order === -1 ? Infinity : b.order;
        return orderA - orderB;
    });

    folderData.forEach(folder => {
        const folderSection = document.createElement('div');
        folderSection.className = 'folder-section collapsed';

        const folderId = `folder-${folder.fullPath.replace(/[^a-zA-Z0-9]/g, '_')}`;

        const folderHeaderContent = `
            <span>📁 ${escapeHtml(folder.path)}</span>
            <div class="folder-move-controls">
                ${folder.fullPath ? `<button class="btn-move" onclick="event.stopPropagation(); moveToTop('${escapeHtml(folder.fullPath).replace(/'/g, '\\\'')}')" title="Move to top">↑</button>` : ''}
                <span class="folder-toggle">▼</span>
            </div>
        `;

        const folderFilesContent = folder.files.map((file, index) => {
            const fileIndex = getFileIndex(file);
            const isCloudFile = file.name && file.name.includes('_') && !isNaN(file.name.split('_')[0]);
            return `
                <button class="file-tab ${file.name === currentFileName ? 'active' : ''} ${isCloudFile ? 'cloud-file' : ''}" 
                        onclick="selectFile(${fileIndex}, '${escapeHtml(folder.fullPath).replace(/'/g, '\\\'')}')"
                        title="${escapeHtml(file.name)}">
                    ${escapeHtml(file.name)}
                </button>
            `;
        }).join('');

        folderSection.innerHTML = `
            <div class="folder-header" onclick="toggleFolder('${folderId}')">
                ${folderHeaderContent}
            </div>
            <div class="folder-files" id="${folderId}">
                ${folderFilesContent}</div>
        `;

        container.appendChild(folderSection);
    });
}

function toggleFolder(folderId) {
    const folderElement = document.getElementById(folderId);
    if (folderElement) {
        const folderSection = folderElement.parentElement;
        folderSection.classList.toggle('collapsed');
    }
}

async function loadAudioFile(file) {
    if (!file.type.startsWith('audio/')) {
        alert('Please select a valid audio file. Selected file type: ' + (file.type || 'unknown'));
        return;
    }

    document.querySelector('.cloud-section').classList.add('hidden');
    document.querySelector('.data-management-section').classList.add('hidden');

    currentFileName = file.name;

    const audioPlayer = document.getElementById('audioPlayer');
    const fileNameSpan = document.getElementById('fileName');
    const currentFileDiv = document.getElementById('currentFile');
    const noteInput = document.getElementById('noteInput');
    const addNoteBtn = document.getElementById('addNoteBtn');

    if (currentAudio) {
        URL.revokeObjectURL(currentAudio);
    }

    try {
        currentAudio = URL.createObjectURL(file);
        audioPlayer.src = currentAudio;
        audioPlayer.style.display = 'block';
        audioPlayer.currentTime = 0;

    } catch (error) {
        console.error('Error creating object URL:', error);
        alert('Error loading audio file. Please try again.');
        return;
    }

    currentFileDiv.style.display = 'block';
    fileNameSpan.textContent = currentFileName;

    noteInput.disabled = false;
    addNoteBtn.disabled = false;

    await loadNotesForProfile();
    updateFolderDisplay();
}

function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateTimeDisplay() {
    const audioPlayer = document.getElementById('audioPlayer');
    const timeDisplay = document.getElementById('timeDisplay');

    if (!audioPlayer || !timeDisplay) {
        return;
    }

    const current = formatTime(audioPlayer.currentTime || 0);
    const duration = formatTime(audioPlayer.duration || 0);
    const statusIndicator = document.getElementById('statusIndicator');

    timeDisplay.innerHTML = `<span class="status-indicator ${statusIndicator.className}" id="statusIndicator"></span>${current} / ${duration}`;
}

function updateStatus() {
    const audioPlayer = document.getElementById('audioPlayer');
    const statusIndicator = document.getElementById('statusIndicator');

    if (!audioPlayer || !statusIndicator) {
        return;
    }

    statusIndicator.className = 'status-indicator ';

    if (audioPlayer.paused) {
        if (audioPlayer.currentTime === 0) {
            statusIndicator.className += 'status-stopped';
        } else {
            statusIndicator.className += 'status-paused';
        }
    } else {
        statusIndicator.className += 'status-playing';
    }
}

// Notes Management Functions
async function addNote() {
    const audioPlayer = document.getElementById('audioPlayer');
    const noteInput = document.getElementById('noteInput');

    if (!audioPlayer || !noteInput || !currentFileName) {
        return;
    }

    if (!currentProfileId) {
        alert('Please select a profile first');
        return;
    }

    const text = noteInput.value.trim();
    if (!text) {
        alert('Please enter a note before adding.');
        return;
    }

    const timestamp = audioPlayer.currentTime || 0;
    const timeString = formatTime(timestamp);

    try {
        const { data, error } = await supabase
            .from('notes')
            .insert([{
                profile_id: currentProfileId,
                file_name: currentFileName,
                timestamp: timestamp,
                time_string: timeString,
                text: text
            }])
            .select()
            .single();

        if (error) throw error;

        const note = {
            id: data.id,
            timestamp: data.timestamp,
            timeString: data.time_string,
            text: data.text,
            fileName: data.file_name,
            createdAt: data.created_at
        };

        notes.push(note);
        notes.sort((a, b) => a.timestamp - b.timestamp);

        noteInput.value = '';
        renderNotes();
    } catch (error) {
        console.error('Error adding note:', error);
        alert('Failed to add note: ' + error.message);
    }
}

async function deleteNote(id) {
    if (!confirm('Are you sure you want to delete this note?')) {
        return;
    }

    try {
        const { error } = await supabase
            .from('notes')
            .delete()
            .eq('id', id);

        if (error) throw error;

        notes = notes.filter(note => note.id !== id);
        renderNotes();
    } catch (error) {
        console.error('Error deleting note:', error);
        alert('Failed to delete note: ' + error.message);
    }
}

function editNote(id) {
    const noteItem = document.querySelector(`[data-note-id="${id}"]`);
    if (noteItem) {
        noteItem.classList.add('edit-mode');

        const editBtn = noteItem.querySelector('button[onclick*="editNote"]');
        const saveBtn = noteItem.querySelector('button[onclick*="saveNote"]');
        const cancelBtn = noteItem.querySelector('button[onclick*="cancelEdit"]');

        if (editBtn) editBtn.style.display = 'none';
        if (saveBtn) saveBtn.style.display = 'inline-block';
        if (cancelBtn) cancelBtn.style.display = 'inline-block';
    }
}

async function saveNote(id) {
    const noteItem = document.querySelector(`[data-note-id="${id}"]`);
    if (!noteItem) return;

    const editInput = noteItem.querySelector('.note-edit-input');
    if (!editInput) return;

    const newText = editInput.value.trim();

    if (!newText) {
        alert('Note cannot be empty.');
        return;
    }

    try {
        const { error } = await supabase
            .from('notes')
            .update({ text: newText, updated_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;

        const note = notes.find(n => n.id === id);
        if (note) {
            note.text = newText;
            renderNotes();
        }
    } catch (error) {
        console.error('Error updating note:', error);
        alert('Failed to update note: ' + error.message);
    }
}

function cancelEdit(id) {
    const noteItem = document.querySelector(`[data-note-id="${id}"]`);
    if (noteItem) {
        noteItem.classList.remove('edit-mode');

        const editBtn = noteItem.querySelector('button[onclick*="editNote"]');
        const saveBtn = noteItem.querySelector('button[onclick*="saveNote"]');
        const cancelBtn = noteItem.querySelector('button[onclick*="cancelEdit"]');

        if (editBtn) editBtn.style.display = 'inline-block';
        if (saveBtn) saveBtn.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'none';
    }
}

function jumpToTime(timestamp) {
    const audioPlayer = document.getElementById('audioPlayer');
    if (audioPlayer && !isNaN(timestamp) && timestamp >= 0) {
        audioPlayer.currentTime = timestamp;
        audioPlayer.focus();
    }
}

function renderNotes() {
    const notesList = document.getElementById('notesList');

    if (notes.length === 0) {
        notesList.innerHTML = '<div class="empty-state">No notes yet. Add a note using the form above.</div>';
        return;
    }

    notesList.innerHTML = notes.map(note => `
        <div class="note-item" data-note-id="${note.id}">
            <div class="note-timestamp" onclick="jumpToTime(${note.timestamp})">
                ${escapeHtml(note.timeString)}
            </div>
            <div class="note-text">${escapeHtml(note.text)}</div>
            <textarea class="note-edit-input">${escapeHtml(note.text)}</textarea>
            <div class="note-actions">
                <button class="btn-icon" onclick="editNote('${note.id}')" title="Edit">✏️</button>
                <button class="btn-icon" onclick="saveNote('${note.id}')" title="Save" style="display: none;">💾</button>
                <button class="btn-icon" onclick="cancelEdit('${note.id}')" title="Cancel" style="display: none;">❌</button>
                <button class="btn-icon" onclick="deleteNote('${note.id}')" title="Delete">🗑️</button>
            </div>
        </div>
    `).join('');

    notes.forEach(note => {
        const noteItem = document.querySelector(`[data-note-id="${note.id}"]`);
        if (!noteItem) return;

        const editInput = noteItem.querySelector('.note-edit-input');
        if (!editInput) return;

        editInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelEdit(note.id);
            } else if (e.key === 'Enter' && e.ctrlKey) {
                saveNote(note.id);
            }
        });
    });
}

// Export/Import Functions (Legacy - for backward compatibility)
async function exportNotes() {
    if (notes.length === 0) {
        alert('No notes to export.');
        return;
    }

    const exportData = {
        fileName: currentFileName,
        profileId: currentProfileId,
        profileName: profiles.find(p => p.id === currentProfileId)?.name || 'Unknown',
        exportDate: new Date().toISOString(),
        notes: notes
    };

    try {
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentFileName.replace(/\.[^/.]+$/, '')}_notes.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Error exporting notes:', error);
        alert('Error exporting notes. Please try again.');
    }
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const importData = JSON.parse(e.target.result);

            if (!importData.notes || !Array.isArray(importData.notes)) {
                alert('Invalid notes file format.');
                event.target.value = '';
                return;
            }

            if (!currentProfileId) {
                alert('Please select a profile first');
                event.target.value = '';
                return;
            }

            const shouldReplace = confirm(
                `Import ${importData.notes.length} notes? This will add them to the current profile.`
            );

            if (shouldReplace) {
                let imported = 0;
                for (const note of importData.notes) {
                    try {
                        await supabase.from('notes').insert([{
                            profile_id: currentProfileId,
                            file_name: currentFileName,
                            timestamp: note.timestamp || 0,
                            time_string: note.timeString || formatTime(note.timestamp || 0),
                            text: note.text
                        }]);
                        imported++;
                    } catch (error) {
                        console.error('Error importing note:', error);
                    }
                }

                await loadNotesForProfile();
                alert(`${imported} notes imported successfully!`);
            }
        } catch (error) {
            console.error('Error importing notes:', error);
            alert('Error reading notes file: ' + error.message);
        }

        event.target.value = '';
    };

    reader.onerror = function (error) {
        console.error('FileReader error:', error);
        alert('Error reading file. Please try again.');
        event.target.value = '';
    };

    reader.readAsText(file);
}

// Enhanced Data Management Functions
async function getAllStoredData() {
    if (!isCloudConnected || !currentProfileId) {
        return {};
    }

    try {
        const { data, error } = await supabase
            .from('notes')
            .select('*')
            .eq('profile_id', currentProfileId);

        if (error) throw error;

        const allData = {};

        (data || []).forEach(note => {
            if (!allData[note.file_name]) {
                allData[note.file_name] = {
                    fileName: note.file_name,
                    notes: [],
                    noteCount: 0,
                    lastModified: 0
                };
            }

            allData[note.file_name].notes.push({
                id: note.id,
                timestamp: note.timestamp,
                timeString: note.time_string,
                text: note.text,
                fileName: note.file_name,
                createdAt: note.created_at
            });

            allData[note.file_name].noteCount++;

            const noteTime = new Date(note.updated_at || note.created_at).getTime();
            if (noteTime > allData[note.file_name].lastModified) {
                allData[note.file_name].lastModified = noteTime;
            }
        });

        return allData;
    } catch (error) {
        console.error('Error getting stored data:', error);
        return {};
    }
}

async function exportAllData() {
    const format = document.getElementById('exportFormat').value;
    const scope = document.getElementById('exportScope').value;

    if (!currentProfileId) {
        showStatus('error', 'Please select a profile first');
        return;
    }

    showStatus('info', 'Preparing export...');
    showProgress(0);

    setTimeout(async () => {
        try {
            let dataToExport = {};
            const allData = await getAllStoredData();

            switch (scope) {
                case 'current':
                    if (currentFileName && allData[currentFileName]) {
                        dataToExport[currentFileName] = allData[currentFileName];
                    } else {
                        showStatus('error', 'No current file selected or no data found.');
                        hideProgress();
                        return;
                    }
                    break;
                case 'all':
                case 'selected':
                    dataToExport = allData;
                    break;
            }

            if (Object.keys(dataToExport).length === 0) {
                showStatus('error', 'No data found to export.');
                hideProgress();
                return;
            }

            showProgress(50);

            let exportContent, mimeType, fileExtension;

            switch (format) {
                case 'json':
                    exportContent = JSON.stringify({
                        exportDate: new Date().toISOString(),
                        exportFormat: 'json',
                        exportScope: scope,
                        profileId: currentProfileId,
                        profileName: profiles.find(p => p.id === currentProfileId)?.name || 'Unknown',
                        totalFiles: Object.keys(dataToExport).length,
                        totalNotes: Object.values(dataToExport).reduce((sum, file) => sum + file.noteCount, 0),
                        data: dataToExport
                    }, null, 2);
                    mimeType = 'application/json';
                    fileExtension = 'json';
                    break;

                case 'csv':
                    const csvRows = ['File Name,Timestamp,Time String,Note Text,Created At'];
                    Object.values(dataToExport).forEach(fileData => {
                        fileData.notes.forEach(note => {
                            const row = [
                                `"${fileData.fileName}"`,
                                note.timestamp || 0,
                                `"${note.timeString || ''}"`,
                                `"${(note.text || '').replace(/"/g, '""')}"`,
                                `"${note.createdAt || ''}"`
                            ].join(',');
                            csvRows.push(row);
                        });
                    });
                    exportContent = csvRows.join('\n');
                    mimeType = 'text/csv';
                    fileExtension = 'csv';
                    break;

                case 'txt':
                    const txtLines = [`Audio Notes Export - ${new Date().toLocaleString()}`, ''];
                    Object.values(dataToExport).forEach(fileData => {
                        txtLines.push(`=== ${fileData.fileName} ===`);
                        txtLines.push(`Notes: ${fileData.noteCount}`);
                        txtLines.push('');
                        fileData.notes.forEach(note => {
                            txtLines.push(`[${note.timeString}] ${note.text}`);
                        });
                        txtLines.push('');
                    });
                    exportContent = txtLines.join('\n');
                    mimeType = 'text/plain';
                    fileExtension = 'txt';
                    break;

                case 'markdown':
                    const mdLines = [`# Audio Notes Export`, `*Generated on ${new Date().toLocaleString()}*`, ''];
                    Object.values(dataToExport).forEach(fileData => {
                        mdLines.push(`## ${fileData.fileName}`);
                        mdLines.push(`**Notes:** ${fileData.noteCount}`);
                        mdLines.push('');
                        fileData.notes.forEach(note => {
                            mdLines.push(`### ${note.timeString}`);
                            mdLines.push(note.text);
                            mdLines.push('');
                        });
                    });
                    exportContent = mdLines.join('\n');
                    mimeType = 'text/markdown';
                    fileExtension = 'md';
                    break;
            }

            showProgress(90);

            const blob = new Blob([exportContent], { type: mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audio_notes_export_${new Date().toISOString().split('T')[0]}.${fileExtension}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showProgress(100);
            showStatus('success', `Export completed! ${Object.keys(dataToExport).length} files exported.`);

            setTimeout(() => {
                hideProgress();
                hideStatus();
            }, 3000);

        } catch (error) {
            console.error('Export error:', error);
            showStatus('error', 'Export failed: ' + error.message);
            hideProgress();
        }
    }, 500);
}

function handleImportAllData(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!currentProfileId) {
        alert('Please select a profile first');
        event.target.value = '';
        return;
    }

    showStatus('info', 'Reading import file...');
    showProgress(0);

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            showProgress(30);

            const importData = JSON.parse(e.target.result);
            const fileExtension = file.name.split('.').pop().toLowerCase();

            if (fileExtension !== 'json') {
                throw new Error('Unsupported file format. Please use JSON files for import.');
            }

            if (importData.data && typeof importData.data === 'object') {
                const filesToImport = Object.keys(importData.data);
                const totalNotes = Object.values(importData.data).reduce((sum, file) => sum + (file.notes ? file.notes.length : 0), 0);

                const shouldImport = confirm(
                    `Import data for ${filesToImport.length} audio files (${totalNotes} total notes)?\n\nThis will add notes to the current profile.`
                );

                if (shouldImport) {
                    showProgress(60);

                    let importedFiles = 0;
                    let importedNotes = 0;

                    for (const [fileName, fileData] of Object.entries(importData.data)) {
                        if (fileData.notes && Array.isArray(fileData.notes)) {
                            for (const note of fileData.notes) {
                                try {
                                    await supabase.from('notes').insert([{
                                        profile_id: currentProfileId,
                                        file_name: fileName,
                                        timestamp: note.timestamp || 0,
                                        time_string: note.timeString || formatTime(note.timestamp || 0),
                                        text: note.text
                                    }]);
                                    importedNotes++;
                                } catch (error) {
                                    console.error('Error importing note:', error);
                                }
                            }
                            importedFiles++;
                        }
                    }

                    showProgress(90);

                    if (currentFileName) {
                        await loadNotesForProfile();
                    }

                    showProgress(100);
                    showStatus('success', `Import completed! ${importedFiles} files and ${importedNotes} notes imported.`);
                }
            } else {
                throw new Error('Invalid JSON format. Expected data with notes structure.');
            }

            setTimeout(() => {
                hideProgress();
                hideStatus();
            }, 3000);

        } catch (error) {
            console.error('Import error:', error);
            showStatus('error', 'Import failed: ' + error.message);
            hideProgress();
        }

        event.target.value = '';
    };

    reader.onerror = function (error) {
        console.error('FileReader error:', error);
        showStatus('error', 'Error reading file. Please try again.');
        hideProgress();
        event.target.value = '';
    };

    reader.readAsText(file);
}

async function clearAllData() {
    if (!currentProfileId) {
        alert('Please select a profile first');
        return;
    }

    const allData = await getAllStoredData();
    const fileCount = Object.keys(allData).length;
    const totalNotes = Object.values(allData).reduce((sum, file) => sum + file.noteCount, 0);

    if (fileCount === 0) {
        alert('No data found to clear.');
        return;
    }

    const profileName = profiles.find(p => p.id === currentProfileId)?.name || 'Unknown';

    const shouldClear = confirm(
        `Are you sure you want to clear ALL data for profile "${profileName}"?\n\nThis will permanently delete:\n- ${fileCount} audio files\n- ${totalNotes} total notes\n\nThis action cannot be undone.`
    );

    if (shouldClear) {
        const doubleConfirm = confirm('This is your final warning. All notes for this profile will be permanently deleted. Continue?');

        if (doubleConfirm) {
            showStatus('info', 'Clearing all data...');
            showProgress(0);

            setTimeout(async () => {
                try {
                    const { error } = await supabase
                        .from('notes')
                        .delete()
                        .eq('profile_id', currentProfileId);

                    if (error) throw error;

                    notes = [];
                    renderNotes();

                    showProgress(100);
                    showStatus('success', `All data cleared! ${totalNotes} notes removed.`);

                    setTimeout(() => {
                        hideProgress();
                        hideStatus();
                    }, 3000);

                } catch (error) {
                    console.error('Clear data error:', error);
                    showStatus('error', 'Error clearing data: ' + error.message);
                    hideProgress();
                }
            }, 500);
        }
    }
}

function showStatus(type, message) {
    const statusDiv = document.getElementById('dataManagementStatus');
    statusDiv.className = `status-message status-${type}`;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';
}

function hideStatus() {
    const statusDiv = document.getElementById('dataManagementStatus');
    statusDiv.style.display = 'none';
}

function showProgress(percentage) {
    const progressDiv = document.getElementById('dataManagementProgress');
    const progressFill = progressDiv.querySelector('.progress-fill');
    progressDiv.style.display = 'block';
    progressFill.style.width = `${percentage}%`;
}

function hideProgress() {
    const progressDiv = document.getElementById('dataManagementProgress');
    progressDiv.style.display = 'none';
}

// UI Toggle Functions
function toggleManagementPanels() {
    const cloudSection = document.querySelector('.cloud-section');
    const dataSection = document.querySelector('.data-management-section');
    const btn = document.getElementById('togglePanelsBtn');

    const isHidden = cloudSection.classList.contains('hidden');

    if (isHidden) {
        cloudSection.classList.remove('hidden');
        dataSection.classList.remove('hidden');
        btn.innerHTML = '⚙️ Hide Management';
    } else {
        cloudSection.classList.add('hidden');
        dataSection.classList.add('hidden');
        btn.innerHTML = '⚙️ Show Management';
    }
}

function toggleTheme() {
    const body = document.body;
    const button = document.querySelector('.theme-toggle');

    if (body.getAttribute('data-theme') === 'dark') {
        body.removeAttribute('data-theme');
        button.textContent = '🌙 Dark Mode';
        try {
            localStorage.setItem('audioNotes_theme', 'light');
        } catch (e) {
            console.log('Could not save theme preference');
        }
    } else {
        body.setAttribute('data-theme', 'dark');
        button.textContent = '☀️ Light Mode';
        try {
            localStorage.setItem('audioNotes_theme', 'dark');
        } catch (e) {
            console.log('Could not save theme preference');
        }
    }
}

function loadTheme() {
    try {
        const savedTheme = localStorage.getItem('audioNotes_theme');
        const button = document.querySelector('.theme-toggle');

        if (savedTheme === 'dark') {
            document.body.setAttribute('data-theme', 'dark');
            button.textContent = '☀️ Light Mode';
        } else {
            button.textContent = '🌙 Dark Mode';
        }
    } catch (e) {
        console.log('Could not load theme preference');
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }

    const audioPlayer = document.getElementById('audioPlayer');
    if (!audioPlayer || !audioPlayer.src) {
        return;
    }

    switch (e.key) {
        case ' ':
            e.preventDefault();
            if (audioPlayer.paused) {
                audioPlayer.play().catch(err => console.log('Play failed:', err));
            } else {
                audioPlayer.pause();
            }
            break;
        case 'ArrowLeft':
            e.preventDefault();
            audioPlayer.currentTime = Math.max(0, audioPlayer.currentTime - 5);
            break;
        case 'ArrowRight':
            e.preventDefault();
            if (!isNaN(audioPlayer.duration)) {
                audioPlayer.currentTime = Math.min(audioPlayer.duration, audioPlayer.currentTime + 5);
            }
            break;
        case 'n':
        case 'N':
            if (e.ctrlKey) {
                e.preventDefault();
                const noteInput = document.getElementById('noteInput');
                if (noteInput && !noteInput.disabled) {
                    noteInput.focus();
                }
            }
            break;
    }
});

// Add Enter + Ctrl shortcut to add note
document.getElementById('noteInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        addNote();
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', function () {
    if (currentAudio) {
        URL.revokeObjectURL(currentAudio);
    }
});