/* Convert adblock-rust's public procedural JSON into uBO's compiled tasks.
 * Shared by the embedded runtime and its contract tests. Unknown/malformed
 * operators reject the whole rule, never broaden its target.
 */
function derpbirdRemovalPattern(value) {
    if (typeof value !== 'string' || !value || value.length > 16384 || value.includes('\0'))
        throw new TypeError('Invalid removal pattern');
    if (value.startsWith('/')) {
        const match = /^\/(.+)\/([imu]*)$/.exec(value);
        if (!match) throw new TypeError('Invalid removal expression');
        return new RegExp(match[1], match[2]);
    }
    return new RegExp('^' + value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$');
}

function derpbirdProceduralRule(input, depth = 0) {
    if (depth > 32) throw new TypeError('Procedural nesting limit');
    if (!input || !Array.isArray(input.selector) || input.selector.length === 0)
        throw new TypeError('Missing procedural selector');
    const escapeRegex = text => text.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
    const textPattern = text => {
        const match = /^\/(.*)\/([imu]*)$/.exec(text);
        if (match) return [match[1], match[2]];
        return ['^' + escapeRegex(text) + '$', ''];
    };
    const unquote = text => {
        const quote = text[0];
        if (quote !== '"' && quote !== "'") return { text, rest: '' };
        let result = '';
        for (let i = 1; i < text.length; i++) {
            const char = text[i];
            if (char === quote) return { text: result, rest: text.slice(i + 1) };
            if (char === '\\' && i + 1 < text.length) {
                const next = text[++i];
                result += next === quote || next === '\\' ? next : '\\' + next;
            } else result += char;
        }
        throw new TypeError('Unterminated procedural string');
    };
    const quotedText = value => {
        const parsed = unquote(value);
        if (parsed.rest) throw new TypeError('Trailing procedural string');
        return parsed.text;
    };
    const result = { raw: JSON.stringify(input), selector: '', tasks: [] };
    for (const operator of input.selector) {
        if (operator && operator.type === 'any') {
            if (!Array.isArray(operator.arg) || !operator.arg.length) throw new TypeError('Missing selector alternatives');
            result.tasks.push(['derpbird-any', operator.arg.map(selector => derpbirdProceduralRule({ selector }, depth + 1))]);
            continue;
        }
        if (operator && ['not', 'matches'].includes(operator.type)) {
            const nested = derpbirdProceduralRule({ selector: operator.arg }, depth + 1);
            if (result.selector === '' && result.tasks.length === 0) result.selector = '*';
            result.tasks.push(['derpbird-' + operator.type, nested]);
            continue;
        }
        if (operator && ['has', 'if', 'if-not'].includes(operator.type)) {
            if (!Array.isArray(operator.arg)) throw new TypeError('Invalid nested selector');
            const nested = derpbirdProceduralRule({ selector: operator.arg }, depth + 1);
            result.tasks.push([operator.type, nested]);
            continue;
        }
        if (!operator || typeof operator.arg !== 'string')
            throw new TypeError('Invalid procedural operand');
        const value = operator.arg;
        switch (operator.type) {
        case 'matches-selector':
            if (!value.trim()) throw new TypeError('Missing subject selector');
            result.tasks.push(['derpbird-matches-selector', value]);
            break;
        case 'css-selector':
            if (result.selector === '' && result.tasks.length === 0) {
                result.selector = value;
            } else {
                result.tasks.push(['spath', value]);
            }
            break;
        case 'has-text':
        case 'matches-path':
        case 'xpath':
            result.tasks.push([operator.type, quotedText(value)]);
            break;
        case 'matches-media':
            if (!value.trim()) throw new TypeError('Missing media query');
            result.tasks.push(['matches-media', quotedText(value)]);
            break;
        case 'others':
            if (value.trim()) throw new TypeError('Unexpected others argument');
            result.tasks.push(['others']);
            break;
        case 'watch-attr':
            // The document observer already watches every attribute and filters
            // our own marker writes. uBO's extra observer would watch those marker
            // writes too, perpetually scheduling another evaluation.
            for (const attr of value.split(',')) {
                const name = quotedText(attr.trim());
                if (name && /[\s<>/=]/.test(name)) throw new TypeError('Invalid watched attribute');
            }
            break;
        case 'min-text-length': {
            if (!/^\d+$/.test(value)) throw new TypeError('Invalid text length');
            const length = Number(value);
            if (!Number.isSafeInteger(length) || length >= 0x7fffffff) throw new TypeError('Invalid text length');
            result.tasks.push([operator.type, length]);
            break;
        }
        case 'upward':
            result.tasks.push(['upward', /^\d+$/.test(value) ? Number(value) : value]);
            if (typeof result.tasks.at(-1)[1] === 'number' &&
                (!Number.isSafeInteger(result.tasks.at(-1)[1]) || result.tasks.at(-1)[1] < 1 || result.tasks.at(-1)[1] >= 256))
                throw new TypeError('Invalid upward distance');
            break;
        case 'matches-css':
        case 'matches-css-before':
        case 'matches-css-after': {
            const colon = value.indexOf(':');
            if (colon <= 0) throw new TypeError('Invalid CSS match');
            const name = value.slice(0, colon).trim();
            const expected = value.slice(colon + 1).trim();
            if (!name || !expected) throw new TypeError('Invalid CSS match');
            result.tasks.push([operator.type, { name, value: textPattern(expected) }]);
            break;
        }
        case 'matches-attr':
        case 'matches-prop': {
            const first = unquote(value);
            let attr, expected;
            if (first.rest) {
                if (!first.rest.startsWith('=')) throw new TypeError('Invalid attribute match');
                attr = first.text;
                expected = quotedText(first.rest.slice(1));
            } else {
                const separator = first.text.indexOf('=');
                attr = separator < 0 ? first.text : first.text.slice(0, separator);
                expected = separator < 0 ? '' : quotedText(first.text.slice(separator + 1));
            }
            if (!attr) throw new TypeError('Invalid attribute match');
            if (operator.type === 'matches-prop' && attr.split('.').some(part => !part))
                throw new TypeError('Invalid property path');
            result.tasks.push([operator.type, { attr, value: expected }]);
            break;
        }
        default:
            throw new TypeError('Unsupported procedural operator');
        }
    }
    if (input.action != null) {
        const { type, arg } = input.action;
        if (!['remove', 'style', 'remove-attr', 'remove-class'].includes(type) ||
            (type !== 'remove' && typeof arg !== 'string'))
            throw new TypeError('Unsupported procedural action');
        if (type === 'remove-attr' || type === 'remove-class') {
            const pattern = quotedText(arg.trim());
            // Reject this rule at installation, not halfway through a DOM pass.
            derpbirdRemovalPattern(pattern);
            result.action = [type, pattern];
        } else {
            result.action = type === 'remove' ? [type] : [type, arg];
        }
    }
    return result;
}


// Extend the pinned executor without changing the vendored uBO source. Use its
// base selector, whose query errors propagate rather than becoming an empty
// match set: an invalid negated branch must never select the whole document.
function derpbirdRegisterProceduralTasks(filterer) {
    const processNodes = filterer.processNodes;
    const removalPatterns = new WeakMap();
    filterer.processNodes = function(nodes, action) {
        if (action?.[0] !== 'remove-attr' && action?.[0] !== 'remove-class')
            return processNodes.call(this, nodes, action);
        let pattern = removalPatterns.get(action);
        if (!pattern) {
            pattern = derpbirdRemovalPattern(action[1]);
            removalPatterns.set(action, pattern);
        }
        const attributes = action[0] === 'remove-attr';
        for (const node of nodes) {
            // DOMTokenList iterators are live: removing the current class while
            // iterating skips its neighbour. Snapshot both name collections.
            const names = attributes ? node.getAttributeNames() : Array.from(node.classList);
            for (const name of names) {
                if (!pattern.test(name)) continue;
                if (attributes) node.removeAttribute(name);
                else node.classList.remove(name);
            }
        }
    };
    const probe = filterer.createProceduralFilter({ selector: '', tasks: [], action: ['remove'] });
    const Selector = Object.getPrototypeOf(Object.getPrototypeOf(probe)).constructor;
    const operators = probe.operatorToTaskMap;
    let generation = 0, inCommit = false;
    const memberships = [];
    const commit = filterer.commitNow;
    filterer.commitNow = function(...args) {
        ++generation; inCommit = true;
        try { return commit.apply(this, args); } finally {
            inCommit = false;
            for (const task of memberships) task.matches?.clear();
        }
    };
    const complete = rule => {
        // A leading procedural predicate applies to every element, rather than
        // treating the Document itself as the only candidate.
        if (rule.selector === '' && rule.tasks[0]?.[0] !== 'derpbird-any')
            return { ...rule, selector: '*' };
        return rule;
    };
    operators.set('derpbird-any', class {
        constructor(task) { this.branches = task[1].map(rule => new Selector(complete(rule))); }
        begin() { this.nodes = new Set(); }
        transpose(node) { for (const branch of this.branches) for (const match of branch.exec(node)) this.nodes.add(match); }
        end(output) { for (const node of this.nodes) output.push(node); this.nodes.clear(); }
    });
    class Membership {
        constructor(task) { this.branch = new Selector(complete(task[1])); this.generation = -1; memberships.push(this); }
        begin() {
            // A nested conditional may call begin for many candidates. Compute
            // its global membership once per filter commit, not once per node.
            if (inCommit && this.generation === generation) return;
            this.matches = new Set(this.branch.exec()); this.generation = generation;
        }
        transpose(node, output) { if (this.matches.has(node) === this.expected) output.push(node); }
        end() {}
    }
    class NegativeMembership extends Membership {}
    NegativeMembership.prototype.expected = false;
    class PositiveMembership extends Membership {}
    PositiveMembership.prototype.expected = true;
    operators.set('derpbird-not', NegativeMembership);
    operators.set('derpbird-matches', PositiveMembership);
    operators.set('derpbird-matches-selector', class {
        constructor(task) { this.selector = task[1]; }
        begin() {}
        transpose(node, output) { if (node.matches(this.selector)) output.push(node); }
        end() {}
    });
}
