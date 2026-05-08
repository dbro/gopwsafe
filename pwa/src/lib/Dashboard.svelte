<script>
    import { createEventDispatcher } from "svelte";
    import { slide } from "svelte/transition";
    import { dbItems, selectedFile } from "../store.js";

    import {
        getRecordData,
        getDatabaseInfo,
        saveDatabase,
        updateRecordFields,
        deleteRecord,
        getDatabaseData,
        searchRecords,
        getAutocompleteSuggestion,
    } from "../wasm.js";
    import Menu from "./Menu.svelte";
    import Modal from "./Modal.svelte";

    import DBInfo from "./DBInfo.svelte";
    import PasswordGenerator from "./PasswordGenerator.svelte";

    const dispatch = createEventDispatcher();

    function autoGrow(node) {
        function resize() {
            node.style.height = 'auto';
            node.style.height = node.scrollHeight + 'px';
        }
        node.addEventListener('input', resize);
        resize();
        return {
            update() { setTimeout(resize, 0); },
            destroy() { node.removeEventListener('input', resize); },
        };
    }

    // Password history field format: fmmnnTLPTLP...
    //   f=enabled(1/0), mm=maxEntries(hex), nn=count(hex)
    //   each entry: T=timestamp(8hex) L=pwLen(4hex) P=password
    function parsePasswordHistory(raw) {
        if (!raw || raw.length < 5) return null;
        const enabled = raw[0] === '1';
        const max = parseInt(raw.slice(1, 3), 16) || 10;
        const count = parseInt(raw.slice(3, 5), 16);
        const entries = [];
        let pos = 5;
        for (let i = 0; i < count; i++) {
            if (pos + 12 > raw.length) break;
            const timestamp = parseInt(raw.slice(pos, pos + 8), 16);
            pos += 8;
            const len = parseInt(raw.slice(pos, pos + 4), 16);
            pos += 4;
            if (pos + len > raw.length) break;
            entries.push({ timestamp, password: raw.slice(pos, pos + len) });
            pos += len;
        }
        return { enabled, max, entries };
    }

    let items = [];
    let filteredItems = [];
    let searchTerm = "";
    let searchNamesOnly = localStorage.getItem('searchNamesOnly') !== 'false';
    let selectedRecord = null;
    let selectedUUID = "";
    let showPassword = false;
    let groupedItems = {};
    let searchInput; // Reference for autofocus
    let titleInput; // Reference for new-record autofocus
    let copyUserSuccess = false;
    let copyPassSuccess = false;
    let copyUrlSuccess = false;
    let isNewRecord = false;
    let showHistory = false;

    let isDirty = false;
    let isRecordDirty = false;
    let flashModTime = false;
    $: if (!selectedRecord) isRecordDirty = false;
    let dbSavedBy = "";
    let dbInfoIsDirty = false;
    let dbInfoInstance = null;
    let showGuard = false;
    let guardConfig = {};
    $: if (!showModal) dbInfoIsDirty = false;
    let showRecordGuard = false;
    let recordGuardProceed = null;
    let recordGuardConfig = { title: "", message: "", confirmLabel: "OK", extraLabel: "", cancelLabel: "Cancel", onConfirm: null, onExtra: null };

    let groupSuggestion = "";
    let groupGhostSuffix = "";
    let usernameSuggestion = "";
    let usernameGhostSuffix = "";

    function clearGhosts() {
        groupSuggestion = "";
        groupGhostSuffix = "";
        usernameSuggestion = "";
        usernameGhostSuffix = "";
    }

    function applySuggestion(field, value) {
        const s = getAutocompleteSuggestion(field, value);
        if (s && s.toLowerCase() !== value.toLowerCase()) {
            return { suggestion: s, ghost: s.slice(value.length) };
        }
        return { suggestion: "", ghost: "" };
    }

    function onGroupInput() {
        isRecordDirty = true;
        const v = selectedRecord.Group;
        if (!v) { groupSuggestion = ""; groupGhostSuffix = ""; return; }
        const r = applySuggestion("group", v);
        groupSuggestion = r.suggestion;
        groupGhostSuffix = r.ghost;
    }

    function onGroupKeydown(e) {
        if (e.key === "Tab" && groupSuggestion) {
            e.preventDefault();
            selectedRecord = { ...selectedRecord, Group: groupSuggestion };
            groupSuggestion = "";
            groupGhostSuffix = "";
        } else if (e.key === "Escape") {
            groupSuggestion = "";
            groupGhostSuffix = "";
        }
    }

    function onUsernameInput() {
        isRecordDirty = true;
        const v = selectedRecord.Username;
        if (!v) { usernameSuggestion = ""; usernameGhostSuffix = ""; return; }
        const r = applySuggestion("username", v);
        usernameSuggestion = r.suggestion;
        usernameGhostSuffix = r.ghost;
    }

    function onUsernameKeydown(e) {
        if (e.key === "Tab" && usernameSuggestion) {
            e.preventDefault();
            selectedRecord = { ...selectedRecord, Username: usernameSuggestion };
            usernameSuggestion = "";
            usernameGhostSuffix = "";
        } else if (e.key === "Escape") {
            usernameSuggestion = "";
            usernameGhostSuffix = "";
        }
    }

    let generator;
    let showGenOptions = false;

    let contextMenu = null; // { x, y, rec }
    function openContextMenu(e, item) {
        e.preventDefault();
        try {
            const rec = getRecordData(item.uuid);
            contextMenu = { x: e.clientX, y: e.clientY, rec };
        } catch (err) {
            console.error("Context menu: failed to load record", err);
        }
    }

    async function contextCopy(text) {
        contextMenu = null;
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error("Failed to copy", err);
        }
    }

    let collapseAtStartup = localStorage.getItem('collapseAtStartup') === 'true';
    function toggleCollapseAtStartup() {
        collapseAtStartup = !collapseAtStartup;
        localStorage.setItem('collapseAtStartup', String(collapseAtStartup));
    }

    let showModal = false;
    let modalConfig = {
        title: "",
        message: "",
        type: "confirm",
        confirmLabel: "OK",
        cancelLabel: "Cancel",
        onConfirm: () => {},
    };

    function triggerModal(config) {
        modalConfig = {
            confirmLabel: "OK",
            cancelLabel: "Cancel",
            extraLabel: "",
            type: "confirm",
            showFooter: true,
            onCancel: null,
            ...config,
        };
        showModal = true;
    }

    function guardUnsavedRecord(proceed) {
        if (!isRecordDirty) { proceed(); return; }
        recordGuardProceed = proceed;
        recordGuardConfig = {
            title: "Unsaved Changes",
            message: `"${selectedRecord.Title}" has unsaved changes.`,
            confirmLabel: "Save",
            extraLabel: "Discard",
            cancelLabel: "Cancel",
            onConfirm: async () => {
                showRecordGuard = false;
                const saved = await saveRecord();
                if (saved && recordGuardProceed) { recordGuardProceed(); recordGuardProceed = null; }
            },
            onExtra: () => {
                showRecordGuard = false;
                if (recordGuardProceed) { recordGuardProceed(); recordGuardProceed = null; }
            },
        };
        showRecordGuard = true;
    }

    function handleKeydown(event) {
        if (event.key === "Escape" && contextMenu) {
            contextMenu = null;
            return;
        }
        // Global shortcuts
        if (
            event.key === "/" &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey
        ) {
            const tag = document.activeElement.tagName.toLowerCase();
            // Ignore if typing in an input or textarea
            if (tag !== "input" && tag !== "textarea") {
                event.preventDefault();
                searchInput.focus();
                searchInput.select();
                return;
            }
        }

        if ((event.ctrlKey || event.metaKey) && event.key === "s") {
            event.preventDefault();
            if (selectedRecord) saveRecord();
            return;
        }

        if (!selectedRecord) return;

        if ((event.ctrlKey || event.metaKey) && event.key === "u") {
            event.preventDefault();
            copyToClipboard(selectedRecord.Username, "user");
        } else if ((event.ctrlKey || event.metaKey) && event.key === "p") {
            event.preventDefault();
            copyToClipboard(selectedRecord.Password, "pass");
        } else if ((event.ctrlKey || event.metaKey) && event.key === "o") {
            event.preventDefault();
            if (selectedRecord.URL) {
                window.open(selectedRecord.URL, "_blank");
            }
        }
    }

    async function copyToClipboard(text, type) {
        try {
            await navigator.clipboard.writeText(text);
            if (type === "user") {
                copyUserSuccess = true;
                setTimeout(() => (copyUserSuccess = false), 2000);
            } else if (type === "pass") {
                copyPassSuccess = true;
                setTimeout(() => (copyPassSuccess = false), 2000);
            } else if (type === "url") {
                copyUrlSuccess = true;
                setTimeout(() => (copyUrlSuccess = false), 2000);
            }
        } catch (err) {
            console.error("Failed to copy!", err);
        }
    }

    dbItems.subscribe((val) => {
        items = val || [];
        filterItems();
        try {
            const info = getDatabaseInfo();
            dbSavedBy = info.who || "";
        } catch (e) { /* ignore if DB not ready */ }
        setTimeout(() => {
            if (searchInput) searchInput.focus();
        }, 100);
    });

    function filterItems() {
        if (!searchTerm.trim()) {
            filteredItems = items;
        } else {
            const matchedUUIDs = new Set(searchRecords(searchTerm, searchNamesOnly));
            filteredItems = items.filter(i => matchedUUIDs.has(i.uuid));
        }
        groupItems(filteredItems);
    }

    function groupItems(itemList) {
        const groups = {};
        itemList.forEach((item) => {
            const g = item.group || "Ungrouped";
            if (!groups[g]) groups[g] = [];
            groups[g].push(item);
        });
        // Sort groups and items in groups
        const sortedKeys = Object.keys(groups).sort();
        const grouped = {};
        sortedKeys.forEach((k) => {
            grouped[k] = groups[k].sort((a, b) =>
                a.title.localeCompare(b.title),
            );
        });
        groupedItems = grouped;
    }

    function selectItem(item) {
        guardUnsavedRecord(() => loadItem(item));
    }

    function loadItem(item) {
        try {
            const rec = getRecordData(item.uuid);
            selectedRecord = rec;
            selectedUUID = item.uuid;
            isRecordDirty = false;
            showPassword = false;
            isNewRecord = false;
            showGenOptions = false;
            showHistory = false;
            clearGhosts();
        } catch (e) {
            console.error(e);
            alert("Failed to load record details");
        }
    }

    function createNewRecord() {
        guardUnsavedRecord(() => startNewRecord());
    }

    function startNewRecord() {
        selectedRecord = {
            Title: "New Record",
            Group: "",
            Username: "",
            Password: "",
            URL: "",
            Notes: "",
            UUID: Array(16).fill(0),
            CreateTime: new Date().toISOString(),
            ModTime: new Date().toISOString(),
        };
        isRecordDirty = false;
        selectedUUID = "";
        showPassword = true;
        isNewRecord = true;
        showGenOptions = false;
        showHistory = false;
        historyRevealedSet = new Set();
        clearGhosts();
        setTimeout(() => { if (titleInput) { titleInput.focus(); titleInput.select(); } }, 50);
    }

    // Bind this to the new record event from the menu
    $: {
        // This is a bit of a hack to listen to events from Menu if passed via props,
        // but here Menu is a component in the markup.
        // We'll handle the event in the markup.
    }

    function formatDate(str) {
        if (!str) return "";
        try {
            return new Date(str).toLocaleString();
        } catch (e) {
            return str;
        }
    }

    async function save(silent = false) {
        try {
            const data = saveDatabase(); // Uint8Array
            let handle = $selectedFile ? $selectedFile.handle : null;

            if (!handle) {
                // Save As
                handle = await window.showSaveFilePicker({
                    suggestedName: $selectedFile
                        ? $selectedFile.name
                        : "pwsafe.psafe3",
                    types: [
                        {
                            description: "Password Safe DB",
                            accept: {
                                "application/octet-stream": [".psafe3", ".dat"],
                            },
                        },
                    ],
                });
            }

            // Write to file
            const writable = await handle.createWritable();
            await writable.write(data);
            await writable.close();

            if (!silent) {
                triggerModal({
                    title: "Success",
                    message: "Database saved successfully!",
                    type: "alert",
                });
            }
            isDirty = false;

            // update store if it was a new file
            if (!$selectedFile || $selectedFile.handle !== handle) {
                selectedFile.update((s) => ({
                    ...s,
                    handle: handle,
                    name: handle.name,
                }));
            }
        } catch (e) {
            console.error("Save failed", e);
            if (e.name !== "AbortError") {
                alert("Failed to save: " + e.message);
            }
        }
    }

    async function saveRecord() {
        await performSave();
        return true;
    }

    async function performSave() {
        try {
            selectedUUID = updateRecordFields(isNewRecord ? "" : selectedUUID, {
                Title:    selectedRecord.Title,
                Group:    selectedRecord.Group,
                Username: selectedRecord.Username,
                Password: selectedRecord.Password,
                URL:      selectedRecord.URL,
                Notes:    selectedRecord.Notes,
            });

            selectedRecord = getRecordData(selectedUUID);

            const items = getDatabaseData();
            dbItems.set(items);

            isNewRecord = false;
            isDirty = true;
            isRecordDirty = false;
            flashModTime = true;
            setTimeout(() => flashModTime = false, 1200);

            if (searchTerm) {
                searchTerm = "";
                filterItems();
            }
        } catch (e) {
            console.error("saveRecord failed:", e);
            alert("Failed to save record: " + e.message);
            return;
        }
        await save(true);
    }

    function deleteCurrentRecord() {
        triggerModal({
            title: "Delete Record",
            message: `Are you sure you want to delete "${selectedRecord.Title}"?`,
            type: "danger",
            confirmLabel: "Delete",
            onConfirm: () => {
                performDelete();
            },
        });
    }

    async function performDelete() {
        try {
            deleteRecord(selectedUUID);
            selectedRecord = null;
            isNewRecord = false;
            isDirty = true;

            // Refresh list
            const items = getDatabaseData();
            dbItems.set(items);
        } catch (e) {
            console.error(e);
            alert("Failed to delete record: " + e.message);
            return;
        }
        await save(true);
    }

    function showDBInfo() {
        try {
            const info = getDatabaseInfo();
            triggerModal({
                title: "Database Info",
                component: DBInfo,
                props: {
                    info: info,
                    filename: $selectedFile ? $selectedFile.name : "",
                },
                showFooter: false,
            });
        } catch (e) {
            console.error(e);
            alert("Failed to get DB info: " + e.message);
        }
    }

    function closeDb() {
        if (isDirty) {
            triggerModal({
                title: "Unsaved Changes",
                message:
                    "You have unsaved changes. Are you sure you want to close without saving?",
                confirmLabel: "Close without saving",
                type: "confirm",
                onConfirm: () => {
                    dispatch("close");
                    isDirty = false;
                },
            });
            return;
        }
        dispatch("close");
        isDirty = false;
    }

    // Warn on tab close
    window.addEventListener("beforeunload", (e) => {
        if (isDirty) {
            e.preventDefault();
            e.returnValue = "";
        }
    });
    function handleTreeNavigation(e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            // Find all visible focusable items
            // We need to look at the entire tree from the container perspective
            const tree = document.querySelector(".tree");
            if (!tree) return;

            const focusable = Array.from(
                tree.querySelectorAll('summary, li[tabindex="0"]'),
            );

            const visibleFocusable = focusable.filter((el) => {
                let parent = el.parentElement;
                while (parent && parent !== tree) {
                    // Check both property and attribute for robustness
                    if (
                        parent.tagName === "DETAILS" &&
                        !parent.open &&
                        !parent.hasAttribute("open")
                    )
                        return false;
                    parent = parent.parentElement;
                }
                return true;
            });

            const idx = visibleFocusable.indexOf(e.target);

            if (idx === -1) {
                // Try finding by activeElement if target mismatch
                const idx2 = visibleFocusable.indexOf(document.activeElement);
                if (idx2 !== -1) {
                    // Use idx2
                    if (e.key === "ArrowDown") {
                        const next = visibleFocusable[idx2 + 1];
                        if (next) {
                            next.focus();
                        }
                    } else if (e.key === "ArrowUp") {
                        const prev = visibleFocusable[idx2 - 1];
                        if (prev) {
                            prev.focus();
                        } else if (idx2 === 0) searchInput.focus();
                    }
                    return;
                }
                return;
            }

            if (e.key === "ArrowDown") {
                const next = visibleFocusable[idx + 1];
                if (next) {
                    next.focus();
                } else {
                    // No next item
                }
            } else if (e.key === "ArrowUp") {
                const prev = visibleFocusable[idx - 1];
                if (prev) prev.focus();
                else if (idx === 0) {
                    searchInput.focus();
                }
            }
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} on:click={() => { if (contextMenu) contextMenu = null; }} />

{#if showModal}
    <Modal
        title={modalConfig.title}
        message={modalConfig.message}
        type={modalConfig.type}
        confirmLabel={modalConfig.confirmLabel}
        cancelLabel={modalConfig.cancelLabel}
        extraLabel={modalConfig.extraLabel || ""}
        showFooter={modalConfig.showFooter !== false}
        on:confirm={() => {
            if (modalConfig.onConfirm) modalConfig.onConfirm();
            showModal = false;
        }}
        on:extra={() => {
            if (modalConfig.onExtra) modalConfig.onExtra();
            showModal = false;
        }}
        on:cancel={() => {
            if (modalConfig.onCancel) {
                modalConfig.onCancel();
            } else if (modalConfig.component === DBInfo && dbInfoIsDirty) {
                guardConfig = {
                    title: "Unsaved Changes",
                    message: "DB Info has unsaved changes.",
                    confirmLabel: "Save",
                    extraLabel: "Discard",
                    cancelLabel: "Cancel",
                };
                showGuard = true;
            } else {
                showModal = false;
            }
        }}
    >
        {#if modalConfig.component}
            <svelte:component
                this={modalConfig.component}
                {...modalConfig.props}
                bind:this={dbInfoInstance}
                on:dirty={(e) => dbInfoIsDirty = e.detail}
                on:save={async () => {
                    await save(true);
                    try {
                        const fresh = getDatabaseInfo();
                        dbSavedBy = fresh.who || "";
                        modalConfig = { ...modalConfig, props: { ...modalConfig.props, info: fresh } };
                    } catch(e) {}
                }}
            />
        {:else}
            <p>{modalConfig.message}</p>
        {/if}
    </Modal>
{/if}

{#if showRecordGuard}
    <Modal
        title={recordGuardConfig.title}
        type="confirm"
        confirmLabel={recordGuardConfig.confirmLabel}
        extraLabel={recordGuardConfig.extraLabel || ""}
        cancelLabel={recordGuardConfig.cancelLabel}
        on:confirm={async () => { if (recordGuardConfig.onConfirm) await recordGuardConfig.onConfirm(); }}
        on:extra={() => { if (recordGuardConfig.onExtra) recordGuardConfig.onExtra(); }}
        on:cancel={() => { showRecordGuard = false; recordGuardProceed = null; }}
    >
        <p>{recordGuardConfig.message}</p>
    </Modal>
{/if}

{#if showGuard}
    <Modal
        title={guardConfig.title}
        message={guardConfig.message}
        type="confirm"
        confirmLabel={guardConfig.confirmLabel}
        extraLabel={guardConfig.extraLabel}
        cancelLabel={guardConfig.cancelLabel}
        on:confirm={async () => {
            showGuard = false;
            if (dbInfoInstance) dbInfoInstance.doSave();
            showModal = false;
        }}
        on:extra={() => { showGuard = false; showModal = false; }}
        on:cancel={() => { showGuard = false; }}
    >
        <p>{guardConfig.message}</p>
    </Modal>
{/if}

<div class="dashboard">
    <div class="sidebar">
        <div class="toolbar">
            <Menu let:close savedBy={dbSavedBy}>
                <button
                    on:click={() => {
                        close();
                        createNewRecord();
                    }}>New Record</button
                >
                <button
                    on:click={() => {
                        close();
                        toggleCollapseAtStartup();
                    }}>{collapseAtStartup ? '✓' : '\u00a0\u00a0'} Collapse at startup</button
                >
                <hr
                    style="border: 0; border-top: 1px solid #444; margin: 5px 0;"
                />
                <button
                    on:click={() => {
                        close();
                        showDBInfo();
                    }}>DB Info</button
                >
                <button
                    on:click={() => {
                        close();
                        closeDb();
                    }}>Close DB</button
                >
            </Menu>
            <!-- Visual Indicator for Dirty State (e.g. dot on menu or title?) 
                 Since we don't have a title bar here (it's in toolbar), maybe add a dot next to Menu?
                 Or just next to Save DB button inside?
            -->
            {#if isDirty}
                <span class="dirty-indicator" title="Unsaved Changes">●</span>
            {/if}

            <input
                bind:this={searchInput}
                type="text"
                placeholder={searchNamesOnly ? "Search names…" : "Search details…"}
                bind:value={searchTerm}
                on:input={filterItems}
                on:keydown={(e) => {
                    if (e.key === "Enter") {
                        if (filteredItems.length === 1) {
                            selectItem(filteredItems[0]);
                            // Move focus to details view for accessibility and to satisfy tests
                            // Wait for DOM update
                            setTimeout(() => {
                                const closeBtn =
                                    document.querySelector(".close-details");
                                if (closeBtn) {
                                    closeBtn.focus();
                                } else {
                                    // If for some reason close button isn't there, blur search
                                    e.target.blur();
                                }
                            }, 50);
                        }
                    } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        const tree = document.querySelector(".tree");
                        if (!tree) {
                            return;
                        }
                        const firstFocusable = tree.querySelector(
                            'summary, li[tabindex="0"]',
                        );
                        if (firstFocusable) {
                            firstFocusable.focus();
                        }
                    } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                    } else if (e.key === "Escape") {
                        searchTerm = "";
                        filterItems();
                    }
                }}
            />
            <label class="scope-label">
                <input
                    type="checkbox"
                    bind:checked={searchNamesOnly}
                    on:change={() => {
                        localStorage.setItem('searchNamesOnly', String(searchNamesOnly));
                        filterItems();
                    }}
                />
                Names only
            </label>
        </div>

        <div class="tree">
            {#each Object.keys(groupedItems) as group}
                <details open={!collapseAtStartup || !!searchTerm}>
                    <summary tabindex="0" on:keydown={handleTreeNavigation}
                        >{group}</summary
                    >
                    <ul role="listbox">
                        {#each groupedItems[group] as item}
                            <li
                                role="option"
                                aria-selected={item.uuid === selectedUUID}
                                tabindex="0"
                                class:selected={item.uuid === selectedUUID}
                                on:click={() => selectItem(item)}
                                on:dblclick={async () => {
                                    try {
                                        const rec = getRecordData(item.uuid);
                                        if (rec && rec.Password) {
                                            await copyToClipboard(rec.Password, 'pass');
                                        }
                                    } catch (err) {
                                        console.error("Double-click copy failed", err);
                                    }
                                }}
                                on:contextmenu={(e) => openContextMenu(e, item)}
                                on:keydown={(e) => {
                                    if (e.key === "Enter") {
                                        selectItem(item);
                                    } else {
                                        handleTreeNavigation(e);
                                    }
                                }}
                            >
                                {item.title}
                            </li>
                        {/each}
                    </ul>
                </details>
            {/each}
        </div>
    </div>

    <div class="main-content" class:mobile-open={!!selectedRecord}>
        {#if selectedRecord}
            <div class="record-details">
                <div class="details-header">
                    <button
                        class="close-details"
                        on:click={() => guardUnsavedRecord(() => { selectedRecord = null; })}>✕</button
                    >
                    <h2>{isNewRecord ? "New Record" : selectedRecord.Title}</h2>
                </div>

                <div class="field">
                    <label for="record-title">Title</label>
                    <input
                        id="record-title"
                        bind:this={titleInput}
                        type="text"
                        bind:value={selectedRecord.Title}
                        placeholder="Title"
                        on:input={() => isRecordDirty = true}
                    />
                </div>

                <div class="field">
                    <label for="record-group">Group</label>
                    <div class="autocomplete-wrap">
                        {#if groupGhostSuffix}
                            <div class="ghost-overlay" aria-hidden="true">
                                <span class="ghost-typed">{selectedRecord.Group}</span><span class="ghost-suffix">{groupGhostSuffix}</span>
                            </div>
                        {/if}
                        <input
                            id="record-group"
                            type="text"
                            bind:value={selectedRecord.Group}
                            placeholder="Group"
                            on:input={onGroupInput}
                            on:keydown={onGroupKeydown}
                            on:blur={() => { groupSuggestion = ""; groupGhostSuffix = ""; }}
                        />
                    </div>
                </div>

                <div class="field">
                    <button type="button" class="field-label-btn" title="Click to copy" on:click={() => copyToClipboard(selectedRecord.Username, 'user')} on:contextmenu|preventDefault={() => copyToClipboard(selectedRecord.Username, 'user')}>Username</button>
                    <div class="field-row">
                        <div class="autocomplete-wrap">
                            {#if usernameGhostSuffix}
                                <div class="ghost-overlay" aria-hidden="true">
                                    <span class="ghost-typed">{selectedRecord.Username}</span><span class="ghost-suffix">{usernameGhostSuffix}</span>
                                </div>
                            {/if}
                            <input
                                id="record-username"
                                aria-label="Username"
                                type="text"
                                bind:value={selectedRecord.Username}
                                placeholder="Username"
                                on:input={onUsernameInput}
                                on:keydown={onUsernameKeydown}
                                on:blur={() => { usernameSuggestion = ""; usernameGhostSuffix = ""; }}
                            />
                        </div>
                        <button
                            class="icon-btn"
                            on:click={() =>
                                copyToClipboard(
                                    selectedRecord.Username,
                                    "user",
                                )}
                            title="Copy Username (Ctrl+U)"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                ><rect
                                    x="9"
                                    y="9"
                                    width="13"
                                    height="13"
                                    rx="2"
                                    ry="2"
                                ></rect><path
                                    d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
                                ></path></svg
                            >
                        </button>
                        {#if copyUserSuccess}
                            <span class="copy-feedback">Copied!</span>
                        {/if}
                    </div>
                </div>
                <div class="field">
                    <button type="button" class="field-label-btn" title="Click to copy" on:click={() => copyToClipboard(selectedRecord.Password, 'pass')} on:contextmenu|preventDefault={() => copyToClipboard(selectedRecord.Password, 'pass')}>Password</button>
                    <div class="password-row">
                        <div class="password-input-row">
                            <input
                                id="record-password"
                                aria-label="Password"
                                type={showPassword ? "text" : "password"}
                                bind:value={selectedRecord.Password}
                                placeholder="Password"
                                on:input={() => isRecordDirty = true}
                            />
                            <button
                                class="icon-btn"
                                on:click={() => copyToClipboard(selectedRecord.Password, "pass")}
                                title="Copy Password (Ctrl+P)"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            </button>
                            {#if copyPassSuccess}
                                <span class="copy-feedback">Copied!</span>
                            {/if}
                        </div>
                        <div class="password-actions">
                            <button on:click={() => (showPassword = !showPassword)}>
                                {showPassword ? "Hide" : "Show"}
                            </button>
                            <button class="generate-btn" on:click={() => generator.generate()}>
                                Generate
                            </button>
                            <button class="icon-btn" on:click={() => (showGenOptions = !showGenOptions)} title="Password options">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
                <PasswordGenerator
                    bind:this={generator}
                    bind:showOptions={showGenOptions}
                    on:generate={(e) => {
                        selectedRecord.Password = e.detail;
                        showPassword = true;
                        isRecordDirty = true;
                    }}
                >
                    {#if !isNewRecord && selectedRecord.PasswordHistory}
                        {@const hist = parsePasswordHistory(selectedRecord.PasswordHistory)}
                        {#if hist && hist.entries.length > 0}
                            <hr class="panel-divider" />
                            <button
                                type="button"
                                class="history-toggle-btn"
                                on:click={() => (showHistory = !showHistory)}
                            >
                                Show {hist.entries.length} previous password{hist.entries.length === 1 ? '' : 's'}
                                <span>{showHistory ? '▲' : '▶'}</span>
                            </button>
                            {#if showHistory}
                                <div class="history-list" transition:slide={{ duration: 150 }}>
                                    {#each [...hist.entries].reverse() as entry}
                                        <div class="history-entry">
                                            <span class="history-date">{formatDate(new Date(entry.timestamp * 1000).toISOString())}</span>
                                            <span class="history-pw">{entry.password}</span>
                                            <button
                                                class="icon-btn"
                                                title="Copy"
                                                on:click={() => copyToClipboard(entry.password, 'hist')}
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                            </button>
                                        </div>
                                    {/each}
                                </div>
                            {/if}
                        {/if}
                    {/if}
                </PasswordGenerator>
                <div class="field">
                    <button type="button" class="field-label-btn" title="Click to copy" on:click={() => copyToClipboard(selectedRecord.URL, 'url')} on:contextmenu|preventDefault={() => copyToClipboard(selectedRecord.URL, 'url')}>URL</button>
                    <div class="field-row">
                        <input
                            id="record-url"
                            aria-label="URL"
                            type="text"
                            bind:value={selectedRecord.URL}
                            placeholder="URL"
                            on:input={() => isRecordDirty = true}
                        />
                        {#if selectedRecord.URL}
                            <a
                                href={selectedRecord.URL}
                                target="_blank"
                                class="icon-btn"
                                title="Open URL (Ctrl+O)"
                            >
                                ↗
                            </a>
                            <button
                                class="icon-btn"
                                on:click={() => copyToClipboard(selectedRecord.URL, 'url')}
                                title="Copy URL"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            </button>
                            {#if copyUrlSuccess}
                                <span class="copy-feedback">Copied!</span>
                            {/if}
                        {/if}
                    </div>
                </div>
                <div class="field">
                    <label for="record-notes">Notes</label>
                    <textarea
                        id="record-notes"
                        bind:value={selectedRecord.Notes}
                        placeholder="Notes"
                        on:input={() => isRecordDirty = true}
                        use:autoGrow={selectedRecord}
                    ></textarea>
                </div>

                <div class="actions-row">
                    <button class="primary" disabled={!isRecordDirty} on:click={saveRecord}
                        >Save Record</button
                    >
                    {#if !isNewRecord}
                        <button class="danger" on:click={deleteCurrentRecord}
                            >Delete Record</button
                        >
                    {/if}
                </div>

                <hr />
                {#if !isNewRecord}
                <div class="meta">
                    <small class:flash-mod-time={flashModTime}>Modified: {formatDate(selectedRecord.ModTime)}</small>
                </div>
                {/if}
            </div>
        {:else}
            <div class="empty-state">Select a record to view details</div>
        {/if}
    </div>
</div>

{#if contextMenu}
    <div
        class="context-menu"
        role="menu"
        tabindex="-1"
        style="left:{contextMenu.x}px;top:{contextMenu.y}px"
        on:click|stopPropagation
        on:keydown|stopPropagation
    >
        <button on:click={() => contextCopy(contextMenu.rec.Username)}>
            Copy Username
        </button>
        <button on:click={() => contextCopy(contextMenu.rec.Password)}>
            Copy Password
        </button>
        {#if contextMenu.rec.URL}
            <button on:click={() => contextCopy(contextMenu.rec.URL)}>
                Copy URL
            </button>
            <button on:click={() => { const url = contextMenu.rec.URL; contextMenu = null; window.open(url, '_blank'); }}>
                Open URL
            </button>
        {/if}
    </div>
{/if}

<style>
    .dashboard {
        display: flex;
        height: 100vh;
        width: 100%;
        text-align: left;
    }
    .sidebar {
        width: 300px;
        background: #252526;
        border-right: 1px solid #333;
        display: flex;
        flex-direction: column;
    }
    .toolbar {
        padding: 10px;
        border-bottom: 1px solid #333;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }
    .toolbar input[type="text"] {
        flex: 1;
        min-width: 0;
        padding: 5px;
        background: #3c3c3c;
        border: 1px solid #555;
        color: #fff;
    }
    .scope-label {
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        font-size: 0.8em;
        color: #aaa;
        cursor: pointer;
    }
    .tree {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
    }
    .tree ul {
        list-style: none;
        padding-left: 20px;
        margin: 5px 0;
    }
    .tree li {
        padding: 4px 8px;
        cursor: pointer;
        border-radius: 3px;
    }
    .tree li:hover {
        background: #37373d;
    }
    .tree li.selected {
        background: #094771;
        color: white;
    }
    details summary {
        cursor: pointer;
        font-weight: bold;
        color: #ccc;
    }
    .main-content {
        flex: 1;
        padding: 20px;
        overflow-y: auto;
        background: #1e1e1e;
    }
    .details-header {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .close-details {
        background: none;
        border: none;
        color: #ccc;
        font-size: 1.5rem;
        cursor: pointer;
    }
    @media (max-width: 768px) {
        .sidebar {
            width: 100%;
            height: 100vh;
        }
        .main-content {
            position: fixed; /* Overlay */
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            transform: translateX(100%); /* Hidden by default */
            transition: transform 0.3s ease-in-out;
            z-index: 2000;
        }
        .main-content.mobile-open {
            transform: translateX(0);
        }
        .close-details {
            display: block;
        }
    }
    .record-details {
        max-width: 800px;
        margin: 0 auto;
    }
    .field {
        margin-bottom: 20px;
    }
    .field label {
        display: block;
        color: #888;
        font-size: 0.9em;
        margin-bottom: 6px;
    }
    .field-label-btn {
        display: block;
        background: none;
        border: none;
        color: #888;
        font-size: 0.9em;
        margin-bottom: 6px;
        padding: 0;
        cursor: pointer;
        font-family: inherit;
        text-align: left;
    }
    .field-label-btn:hover {
        color: #bbb;
    }
    .field input[type="text"],
    .field input[type="password"],
    .field textarea {
        width: 100%;
        padding: 8px;
        background: #333;
        border: 1px solid #444;
        color: #fff;
        border-radius: 4px;
        font-size: 1rem;
    }
    .field input:focus,
    .field textarea:focus {
        border-color: #007bff;
        outline: none;
    }
    .password-row {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .password-input-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    .password-input-row input {
        flex: 1;
        min-width: 0;
        width: auto;
    }
    .password-actions {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    textarea {
        background: #2d2d2d;
        padding: 10px;
        border-radius: 4px;
        white-space: pre-wrap;
        font-family: inherit;
        resize: none;
        line-height: 1.5;
        min-height: calc(5 * 1.5em + 20px);
        max-height: calc(20 * 1.5em + 20px);
        overflow-y: auto;
    }
    .empty-state {
        display: flex;
        height: 100%;
        align-items: center;
        justify-content: center;
        color: #666;
    }
    .field-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .field-row input {
        flex: 1;
        width: auto; /* Override the 100% from general input selector */
        min-width: 0;
    }
    .icon-btn {
        background: none;
        border: none;
        color: #ccc;
        cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        border-radius: 4px;
    }
    .icon-btn:hover {
        background: #333;
        color: #fff;
    }
    .copy-feedback {
        color: #4caf50;
        font-size: 0.9em;
        animation: fadeOut 2s forwards;
    }
    .panel-divider {
        border: none;
        border-top: 1px solid #3a3a3a;
        margin: 8px 0 6px;
    }
    .history-toggle-btn {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        background: none;
        border: none;
        color: #888;
        font-size: 0.8em;
        padding: 2px 0;
        cursor: pointer;
        font-family: inherit;
        text-align: left;
    }
    .history-toggle-btn:hover {
        color: #bbb;
    }
    .history-list {
        margin-top: 6px;
        border: 1px solid #333;
        border-radius: 4px;
        overflow: hidden;
    }
    .history-entry {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-bottom: 1px solid #2a2a2a;
        font-size: 0.85em;
    }
    .history-entry:last-child {
        border-bottom: none;
    }
    .history-entry:nth-child(odd) {
        background: #252525;
    }
    .history-date {
        color: #666;
        white-space: nowrap;
        flex-shrink: 0;
    }
    .history-pw {
        flex: 1;
        font-family: monospace;
        color: #ccc;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .actions-row {
        margin-top: 30px;
        display: flex;
        gap: 10px;
        justify-content: flex-end;
    }
    button.primary {
        background: #007bff;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
    }
    button.primary:hover {
        background: #0056b3;
    }
    button.primary:disabled {
        background: #444;
        color: #777;
        cursor: default;
    }
    button.danger {
        background: #dc3545;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 1rem;
    }
    button.danger:hover {
        background: #a71d2a;
    }

    @keyframes flashModTime {
        0%   { background: #007bff; color: #fff; border-radius: 3px; }
        60%  { background: #007bff; color: #fff; border-radius: 3px; }
        100% { background: transparent; color: inherit; }
    }
    .flash-mod-time {
        animation: flashModTime 1.2s ease-out forwards;
    }

    @keyframes fadeOut {
        0% {
            opacity: 1;
        }
        70% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }
    .context-menu {
        position: fixed;
        z-index: 2000;
        background: #252526;
        border: 1px solid #444;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        padding: 4px 0;
        min-width: 160px;
    }
    .context-menu button {
        display: block;
        width: 100%;
        text-align: left;
        background: none;
        border: none;
        color: #e0e0e0;
        padding: 8px 14px;
        cursor: pointer;
        font-size: 0.9em;
    }
    .context-menu button:hover {
        background: #37373d;
    }
    .autocomplete-wrap {
        position: relative;
        display: block;
    }
    .autocomplete-wrap input {
        width: 100%;
    }
    .field-row .autocomplete-wrap {
        flex: 1;
        min-width: 0;
    }
    .field-row .autocomplete-wrap input {
        width: 100%;
    }
    .ghost-overlay {
        position: absolute;
        inset: 0;
        padding: 8px;
        pointer-events: none;
        font-size: 1rem;
        font-family: inherit;
        line-height: 1.5;
        white-space: pre;
        overflow: hidden;
        border: 1px solid transparent;
        border-radius: 4px;
        z-index: 1;
        display: flex;
        align-items: center;
    }
    .ghost-typed {
        color: transparent;
    }
    .ghost-suffix {
        color: #666;
    }
</style>
