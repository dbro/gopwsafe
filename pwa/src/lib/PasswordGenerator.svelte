<script>
    import { createEventDispatcher } from 'svelte';
    const dispatch = createEventDispatcher();

    export let showOptions = false;

    const SYMBOL_CHARS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.split('');
    const SYMBOL_DEFAULT_OFF = new Set(['"', "'", '<', '>', '\\', '`']);

    const GROUPS = [
        { id: 'upper',   label: 'A–Z',     chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('') },
        { id: 'lower',   label: 'a–z',     chars: 'abcdefghijklmnopqrstuvwxyz'.split('') },
        { id: 'digits',  label: '0–9',     chars: '0123456789'.split('') },
        { id: 'symbols', label: 'Symbols', chars: SYMBOL_CHARS },
    ];

    function makeDefault() {
        const groups = {};
        for (const g of GROUPS) {
            groups[g.id] = {
                state: (g.id === 'upper' || g.id === 'lower') ? 'require' : 'allow',
                chars: Object.fromEntries(
                    g.chars.map(c => [c, g.id !== 'symbols' || !SYMBOL_DEFAULT_OFF.has(c)])
                ),
            };
        }
        return { length: 20, groups };
    }

    function load() {
        try {
            const raw = localStorage.getItem('pwgen');
            if (raw) {
                const p = JSON.parse(raw);
                if (typeof p.length !== 'number') return makeDefault();
                for (const g of GROUPS) {
                    if (!p.groups?.[g.id]) {
                        p.groups[g.id] = makeDefault().groups[g.id];
                    } else {
                        for (const c of g.chars) {
                            if (!(c in p.groups[g.id].chars)) {
                                p.groups[g.id].chars[c] = !SYMBOL_DEFAULT_OFF.has(c);
                            }
                        }
                    }
                }
                return p;
            }
        } catch (_) {}
        return makeDefault();
    }

    let s = load();

    function persist() {
        localStorage.setItem('pwgen', JSON.stringify(s));
    }

    function setGroupState(id, state) {
        s.groups[id].state = state;
        s = s;
        persist();
    }

    function toggleChar(id, c) {
        s.groups[id].chars[c] = !s.groups[id].chars[c];
        s = s;
        persist();
    }

    function updateLength(e) {
        const v = parseInt(e.target.value, 10);
        if (v >= 4 && v <= 64) {
            s.length = v;
            persist();
        } else {
            e.target.value = Math.min(64, Math.max(4, v || 4));
        }
    }

    function randInt(max) {
        const arr = new Uint32Array(1);
        const limit = Math.floor(0x100000000 / max) * max;
        let r;
        do { crypto.getRandomValues(arr); r = arr[0]; } while (r >= limit);
        return r % max;
    }

    export function generate() {
        let pool = [];
        let guaranteed = [];
        for (const g of GROUPS) {
            const gs = s.groups[g.id];
            if (gs.state === 'off') continue;
            const active = g.chars.filter(c => gs.chars[c]);
            if (!active.length) continue;
            pool.push(...active);
            if (gs.state === 'require') {
                guaranteed.push(active[randInt(active.length)]);
            }
        }
        if (!pool.length) return;

        const len = s.length;
        const result = guaranteed.slice(0, len);
        while (result.length < len) result.push(pool[randInt(pool.length)]);

        for (let i = result.length - 1; i > 0; i--) {
            const j = randInt(i + 1);
            [result[i], result[j]] = [result[j], result[i]];
        }
        dispatch('generate', result.join(''));
    }
</script>

{#if showOptions}
<div class="pwgen-panel">
    <div class="panel-header">
        <span class="panel-title">Generation options</span>
        <label class="length-label">
            Length
            <input
                type="number"
                min="4"
                max="64"
                value={s.length}
                on:change={updateLength}
                on:blur={updateLength}
                class="length-input"
            />
        </label>
        <button class="collapse-btn" on:click={() => (showOptions = false)} title="Hide options">▲</button>
    </div>

    {#each GROUPS as g}
        {@const gs = s.groups[g.id]}
        <div class="group" class:group-off={gs.state === 'off'}>
            <div class="group-header">
                <span class="group-label">{g.label}</span>
                <div class="state-bar">
                    {#each ['require', 'allow', 'off'] as state}
                        <button
                            class="state-btn"
                            class:active={gs.state === state}
                            on:click={() => setGroupState(g.id, state)}
                        >{state}</button>
                    {/each}
                </div>
            </div>
            <div class="chars">
                {#each g.chars as c}
                    <button
                        class="char-btn"
                        class:char-on={gs.chars[c] && gs.state !== 'off'}
                        class:char-off={!gs.chars[c] && gs.state !== 'off'}
                        disabled={gs.state === 'off'}
                        on:click={() => toggleChar(g.id, c)}
                        title={gs.chars[c] ? 'Click to exclude' : 'Click to include'}
                    >{c}</button>
                {/each}
            </div>
        </div>
    {/each}
</div>
{/if}

<style>
    .pwgen-panel {
        border: 1px solid #444;
        border-radius: 4px;
        padding: 8px 10px;
        background: #2a2a2a;
        margin-top: 6px;
    }
    .panel-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 8px;
    }
    .panel-title {
        font-size: 0.75em;
        color: #888;
        font-weight: bold;
        flex: 1;
    }
    .length-label {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #ccc;
        font-size: 0.85em;
    }
    .length-input {
        width: 52px;
        padding: 3px;
        background: #333;
        border: 1px solid #555;
        color: #fff;
        border-radius: 4px;
        text-align: center;
        font-size: 0.85em;
    }
    .collapse-btn {
        background: none;
        border: none;
        color: #666;
        cursor: pointer;
        font-size: 0.75em;
        padding: 2px 4px;
        line-height: 1;
    }
    .collapse-btn:hover {
        color: #ccc;
    }
    .group {
        margin-bottom: 6px;
    }
    .group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 3px;
    }
    .group-label {
        font-size: 0.75em;
        color: #888;
        font-weight: bold;
        min-width: 48px;
    }
    .state-bar {
        display: flex;
        border: 1px solid #555;
        border-radius: 3px;
        overflow: hidden;
    }
    .state-btn {
        background: none;
        border: none;
        border-right: 1px solid #555;
        color: #888;
        font-size: 0.7em;
        padding: 2px 7px;
        cursor: pointer;
        text-transform: capitalize;
    }
    .state-btn:last-child {
        border-right: none;
    }
    .state-btn.active {
        background: #555;
        color: #fff;
    }
    .state-btn:hover:not(.active) {
        background: #3a3a3a;
        color: #ccc;
    }
    .chars {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
    }
    .char-btn {
        width: 22px;
        height: 22px;
        font-size: 0.78em;
        font-family: monospace;
        padding: 0;
        border-radius: 3px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid #3a3a3a;
        background: #1e1e1e;
        color: #555;
        transition: transform 0.08s ease;
        position: relative;
    }
    .char-btn:hover {
        transform: scale(2.5);
        z-index: 10;
    }
    .char-btn.char-on {
        background: #3c3c3c;
        border-color: #666;
        color: #e0e0e0;
    }
    .char-btn.char-off {
        background: #1e1e1e;
        border-color: #333;
        color: #444;
        text-decoration: line-through;
    }
    .char-btn:disabled {
        cursor: not-allowed;
        opacity: 0.35;
    }
    .char-btn:not(:disabled).char-on:hover {
        background: #505050;
        border-color: #888;
    }
    .char-btn:not(:disabled).char-off:hover {
        background: #2a2a2a;
        border-color: #555;
    }
    @media (max-width: 768px) {
        .chars { display: none; }
    }
</style>
