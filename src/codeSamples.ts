import * as vscode from 'vscode';
import * as path from 'path';

// Bundled code samples for when no workspace is available
const BUNDLED_SAMPLES = [
    // JavaScript/TypeScript
    `function fibonacci(n) {
    if (n <= 1) return n;
    return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log(result);`,

    `async function fetchUser(id) {
    const response = await fetch(\`/api/users/\${id}\`);
    const data = await response.json();
    return data;
}`,

    `const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map(n => n * 2);
const filtered = doubled.filter(n => n > 5);
console.log(filtered);`,

    `class EventEmitter {
    constructor() {
        this.events = {};
    }

    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    emit(event, data) {
        if (this.events[event]) {
            this.events[event].forEach(cb => cb(data));
        }
    }
}`,

    // Python
    `def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)`,

    `class Database:
    def __init__(self, host, port):
        self.host = host
        self.port = port
        self.connection = None

    def connect(self):
        self.connection = create_connection(self.host, self.port)
        return self.connection`,

    // Rust
    `fn binary_search<T: Ord>(arr: &[T], target: &T) -> Option<usize> {
    let mut left = 0;
    let mut right = arr.len();

    while left < right {
        let mid = left + (right - left) / 2;
        match arr[mid].cmp(target) {
            Ordering::Equal => return Some(mid),
            Ordering::Less => left = mid + 1,
            Ordering::Greater => right = mid,
        }
    }
    None
}`,

    // Go
    `func handleRequest(w http.ResponseWriter, r *http.Request) {
    if r.Method != "POST" {
        http.Error(w, "Method not allowed", 405)
        return
    }

    var data RequestBody
    err := json.NewDecoder(r.Body).Decode(&data)
    if err != nil {
        http.Error(w, err.Error(), 400)
        return
    }

    response := processData(data)
    json.NewEncoder(w).Encode(response)
}`,

    // React/JSX
    `function UserCard({ user, onEdit, onDelete }) {
    const [isHovered, setIsHovered] = useState(false);

    return (
        <div
            className="user-card"
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <img src={user.avatar} alt={user.name} />
            <h3>{user.name}</h3>
            <p>{user.email}</p>
            {isHovered && (
                <div className="actions">
                    <button onClick={() => onEdit(user)}>Edit</button>
                    <button onClick={() => onDelete(user.id)}>Delete</button>
                </div>
            )}
        </div>
    );
}`,

    // TypeScript
    `interface ApiResponse<T> {
    data: T;
    status: number;
    message: string;
}

async function request<T>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    });

    const data = await response.json();
    return {
        data: data as T,
        status: response.status,
        message: response.statusText,
    };
}`,

    // SQL-like
    `const query = db
    .select('users.id', 'users.name', 'orders.total')
    .from('users')
    .leftJoin('orders', 'users.id', 'orders.user_id')
    .where('users.active', true)
    .andWhere('orders.created_at', '>', lastWeek)
    .orderBy('orders.total', 'desc')
    .limit(10);`,

    // Vue-like
    `export default {
    data() {
        return {
            items: [],
            loading: false,
            error: null,
        };
    },
    async mounted() {
        this.loading = true;
        try {
            this.items = await fetchItems();
        } catch (e) {
            this.error = e.message;
        } finally {
            this.loading = false;
        }
    },
    methods: {
        addItem(item) {
            this.items.push(item);
        },
        removeItem(index) {
            this.items.splice(index, 1);
        },
    },
};`,
];

export class CodeSampleProvider {
    private workspaceSamples: string[] = [];
    private lastScanTime: number = 0;
    private scanInterval: number = 60000; // Rescan workspace every minute

    async getRandomSample(preferWorkspace: boolean = true): Promise<string> {
        if (preferWorkspace) {
            await this.ensureWorkspaceSamples();
            if (this.workspaceSamples.length > 0) {
                // 70% chance to use workspace code, 30% bundled
                if (Math.random() < 0.7) {
                    return this.workspaceSamples[Math.floor(Math.random() * this.workspaceSamples.length)];
                }
            }
        }

        return BUNDLED_SAMPLES[Math.floor(Math.random() * BUNDLED_SAMPLES.length)];
    }

    private async ensureWorkspaceSamples(): Promise<void> {
        const now = Date.now();
        if (now - this.lastScanTime < this.scanInterval && this.workspaceSamples.length > 0) {
            return;
        }

        this.lastScanTime = now;
        await this.scanWorkspace();
    }

    private async scanWorkspace(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;

        const samples: string[] = [];
        const extensions = ['ts', 'js', 'tsx', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'cs', 'rb', 'php', 'swift', 'kt'];
        const pattern = `**/*.{${extensions.join(',')}}`;

        try {
            const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 50);

            for (const file of files) {
                try {
                    const document = await vscode.workspace.openTextDocument(file);
                    const content = document.getText();

                    // Extract interesting code snippets (functions, classes, etc.)
                    const snippets = this.extractSnippets(content);
                    samples.push(...snippets);

                    // Limit total samples
                    if (samples.length >= 100) break;
                } catch (e) {
                    // Skip files that can't be read
                }
            }

            this.workspaceSamples = samples.filter(s => s.length >= 50 && s.length <= 800);
        } catch (e) {
            console.error('Failed to scan workspace:', e);
        }
    }

    private extractSnippets(content: string): string[] {
        const snippets: string[] = [];
        const lines = content.split('\n');

        // Look for function/class definitions and extract blocks
        let currentBlock: string[] = [];
        let braceCount = 0;
        let inBlock = false;

        for (const line of lines) {
            // Detect start of interesting blocks
            if (!inBlock && this.isBlockStart(line)) {
                inBlock = true;
                currentBlock = [line];
                braceCount = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
                continue;
            }

            if (inBlock) {
                currentBlock.push(line);
                braceCount += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;

                // End of block
                if (braceCount <= 0 || currentBlock.length > 30) {
                    if (currentBlock.length >= 3 && currentBlock.length <= 25) {
                        snippets.push(currentBlock.join('\n'));
                    }
                    inBlock = false;
                    currentBlock = [];
                    braceCount = 0;
                }
            }
        }

        return snippets;
    }

    private isBlockStart(line: string): boolean {
        const patterns = [
            /^\s*(export\s+)?(async\s+)?function\s+\w+/,
            /^\s*(export\s+)?class\s+\w+/,
            /^\s*(const|let|var)\s+\w+\s*=\s*(async\s+)?\(/,
            /^\s*(const|let|var)\s+\w+\s*=\s*\{/,
            /^\s*def\s+\w+\s*\(/,
            /^\s*class\s+\w+/,
            /^\s*fn\s+\w+/,
            /^\s*func\s+\w+/,
            /^\s*(public|private|protected)?\s*(static\s+)?(async\s+)?\w+\s*\(/,
        ];

        return patterns.some(p => p.test(line));
    }
}
