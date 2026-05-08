<script>
    import { createEventDispatcher } from "svelte";
    import { updateDBInfo } from "../wasm.js";

    export let info = {};
    export let filename = "";

    const dispatch = createEventDispatcher();

    let name = info.name || "";
    let description = info.description || "";
    let lastSaveUser = info.who || "";

    let flashWhen = false;
    let prevWhen = info.when;
    $: if (info.when !== prevWhen) {
        prevWhen = info.when;
        flashWhen = true;
        setTimeout(() => flashWhen = false, 1200);
    }

    $: isDirty = name !== (info.name || "") ||
                 description !== (info.description || "") ||
                 lastSaveUser !== (info.who || "");

    $: dispatch("dirty", isDirty);

    export function doSave() {
        save();
    }

    function save() {
        try {
            updateDBInfo(name, description, lastSaveUser);
            dispatch("save");
        } catch (e) {
            console.error(e);
            alert("Failed to update DB info: " + e.message);
        }
    }
</script>

<div class="db-info">
    <div class="field">
        <label for="dbinfo-filename">Filename</label>
        <input id="dbinfo-filename" type="text" value={filename} readonly disabled />
    </div>

    <div class="field">
        <label for="dbinfo-name">Name</label>
        <input id="dbinfo-name" type="text" bind:value={name} placeholder="Database Name" />
    </div>

    <div class="field">
        <label for="dbinfo-desc">Description</label>
        <textarea id="dbinfo-desc" bind:value={description} rows="3" placeholder="Description"></textarea>
    </div>

    <div class="field">
        <label for="dbinfo-user">Last Saved By</label>
        <input id="dbinfo-user" type="text" bind:value={lastSaveUser} placeholder="Your name" />
    </div>

    <div class="meta-grid">
        <div class="meta-item">
            <span class="meta-label">Last Saved With</span>
            <span>{info.what || "Unknown"}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Last Saved Time</span>
            <span class:flash-when={flashWhen}>{info.when}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Version</span>
            <span>{info.version}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">UUID</span>
            <span class="uuid">{info.uuid}</span>
        </div>
    </div>

    <div class="actions">
        <button class="primary" disabled={!isDirty} on:click={save}>Save</button>
    </div>
</div>

<style>
    .db-info {
        display: flex;
        flex-direction: column;
        gap: 15px;
    }
    .field label,
    .meta-item .meta-label {
        display: block;
        color: #888;
        font-size: 0.9em;
        margin-bottom: 4px;
    }
    input[type="text"],
    textarea {
        width: 100%;
        padding: 8px;
        background: #333;
        border: 1px solid #444;
        color: #fff;
        border-radius: 4px;
        font-size: 1rem;
        box-sizing: border-box;
    }
    input:disabled {
        background: #2a2a2a;
        color: #aaa;
        cursor: not-allowed;
    }
    .meta-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        background: #1e1e1e;
        padding: 10px;
        border-radius: 4px;
        margin-top: 10px;
    }
    .meta-item {
        overflow: hidden;
    }
    .meta-item span:not(.meta-label) {
        display: block;
        color: #ddd;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .uuid {
        font-family: monospace;
        font-size: 0.9em;
    }
    @keyframes flashWhen {
        0%   { background: #007bff; color: #fff; border-radius: 3px; }
        60%  { background: #007bff; color: #fff; border-radius: 3px; }
        100% { background: transparent; color: inherit; }
    }
    .flash-when {
        animation: flashWhen 1.2s ease-out forwards;
    }
    .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 10px;
    }
    button.primary {
        background: #007bff;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
    }
    button.primary:hover:not(:disabled) {
        background: #0056b3;
    }
    button.primary:disabled {
        background: #444;
        color: #777;
        cursor: default;
    }
</style>
