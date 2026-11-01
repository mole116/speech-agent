import { tool } from 'ai';
import { z } from 'zod';
import os from 'os';
const mockDatabase = {
    users: [
        { id: 'usr-101', name: 'Alice Chen', role: 'Staff Engineer', email: 'alice@company.local', status: 'active' },
        { id: 'usr-102', name: 'Bob Martinez', role: 'DevOps Lead', email: 'bob@company.local', status: 'on_call' },
        { id: 'usr-103', name: 'Charlie Kim', role: 'Product Manager', email: 'charlie@company.local', status: 'in_meeting' },
    ],
    devices: [
        { id: 'dev-01', name: 'Main Conference AC', room: 'Boardroom A', state: 'on', temp: 21 },
        { id: 'dev-02', name: 'Lab Overhead Lights', room: 'Hardware Lab', state: 'on' },
        { id: 'dev-03', name: 'Studio Audio Monitor', room: 'Sound Booth', state: 'off' },
        { id: 'dev-04', name: 'M4 Cluster Rack', room: 'Server Room', state: 'on', temp: 18 },
    ],
    orders: [
        { id: 'ord-8001', customer: 'Alice Chen', item: 'M4 Max Workstation', status: 'Out for Delivery', total: '$3,499' },
        { id: 'ord-8002', customer: 'Bob Martinez', item: '4K OLED UltraFine Display', status: 'Delivered', total: '$1,299' },
        { id: 'ord-8003', customer: 'Tech Ops', item: 'Cat8 Ethernet Patch Pack', status: 'Processing', total: '$85' },
    ],
    inventory: [
        { sku: 'HW-M4-01', item: 'MacBook Pro M4', stock: 14, location: 'Shelf B-3' },
        { sku: 'MIC-USB-02', item: 'Shure MV7X Podcaster Mic', stock: 6, location: 'Shelf A-1' },
        { sku: 'ACC-TB4-03', item: 'Thunderbolt 4 Dock', stock: 22, location: 'Shelf C-5' },
    ],
};
const mockLogs = [
    { timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(), level: 'info', module: 'voice_engine', message: 'WebSocket audio stream pipeline initialized at 16kHz mono' },
    { timestamp: new Date(Date.now() - 1000 * 60 * 9).toISOString(), level: 'info', module: 'ollama', message: 'Ollama model qwen2.5-coder:32b loaded into Apple M4 Unified Memory' },
    { timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), level: 'warn', module: 'network', message: 'Transient jitter detected on loopback WebSocket buffer (4ms)' },
    { timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(), level: 'info', module: 'system', message: 'Local system thermal state: Nominal, Fan speed: 0 RPM' },
    { timestamp: new Date(Date.now() - 1000 * 30).toISOString(), level: 'info', module: 'vad', message: 'Voice Activity Detection calibrated: SNR 28dB' },
];
const inMemoryNotes = [
    { id: 'note-1', text: 'Benchmark Ollama qwen2.5-coder:32b token generation rate', category: 'performance', createdAt: new Date(Date.now() - 1000 * 60 * 30).toLocaleTimeString() },
];
// ==========================================
// Vercel AI SDK Tool Definitions
// ==========================================
export const createAgentTools = (onToolEvent) => {
    return {
        checkMockDatabase: tool({
            description: 'Query the local mock database for users, IoT devices, orders, or inventory items.',
            parameters: z.object({
                collection: z.enum(['users', 'devices', 'orders', 'inventory']).describe('The database collection to inspect'),
                searchTerm: z.string().optional().describe('Optional search query to filter records by name, customer, item, or status'),
            }),
            execute: async ({ collection, searchTerm }) => {
                const toolCallId = `call_${Date.now()}_db`;
                onToolEvent?.({ toolCallId, toolName: 'checkMockDatabase', status: 'start', args: { collection, searchTerm } });
                const records = (mockDatabase[collection] || []);
                let filtered = records;
                if (searchTerm) {
                    const term = searchTerm.toLowerCase();
                    filtered = records.filter((rec) => Object.values(rec).some((val) => String(val).toLowerCase().includes(term)));
                }
                const result = {
                    collection,
                    totalMatches: filtered.length,
                    data: filtered.slice(0, 5),
                };
                onToolEvent?.({ toolCallId, toolName: 'checkMockDatabase', status: 'complete', result });
                return result;
            },
        }),
        getSystemMetrics: tool({
            description: 'Retrieve real-time local MacBook Pro M4 hardware and system telemetry (CPU, memory, uptime, OS load).',
            parameters: z.object({
                includeCpuDetails: z.boolean().optional().describe('Whether to return individual core model strings'),
            }),
            execute: async ({ includeCpuDetails = false }) => {
                const toolCallId = `call_${Date.now()}_sys`;
                onToolEvent?.({ toolCallId, toolName: 'getSystemMetrics', status: 'start', args: { includeCpuDetails } });
                const totalMemGb = (os.totalmem() / (1024 ** 3)).toFixed(2);
                const freeMemGb = (os.freemem() / (1024 ** 3)).toFixed(2);
                const usedMemGb = ((os.totalmem() - os.freemem()) / (1024 ** 3)).toFixed(2);
                const memoryUsagePercent = (((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1);
                const cpus = os.cpus();
                const loadAvg = os.loadavg();
                const uptimeHours = (os.uptime() / 3600).toFixed(1);
                const result = {
                    hostname: os.hostname(),
                    platform: os.platform(),
                    release: os.release(),
                    arch: os.arch(),
                    cpuCount: cpus.length,
                    cpuModel: cpus[0]?.model || 'Apple Silicon M4',
                    uptimeHours: `${uptimeHours} hours`,
                    memory: {
                        total: `${totalMemGb} GB`,
                        used: `${usedMemGb} GB`,
                        free: `${freeMemGb} GB`,
                        usagePercent: `${memoryUsagePercent}%`,
                    },
                    loadAverage: {
                        '1m': loadAvg[0]?.toFixed(2),
                        '5m': loadAvg[1]?.toFixed(2),
                        '15m': loadAvg[2]?.toFixed(2),
                    },
                    ...(includeCpuDetails ? { cores: cpus.map((c, i) => ({ core: i, speedMhz: c.speed })) } : {}),
                };
                onToolEvent?.({ toolCallId, toolName: 'getSystemMetrics', status: 'complete', result });
                return result;
            },
        }),
        querySystemLogs: tool({
            description: 'Search or retrieve the most recent local system and application logs with level or keyword filtering.',
            parameters: z.object({
                level: z.enum(['all', 'info', 'warn', 'error']).optional().describe('Log severity level filter'),
                query: z.string().optional().describe('Search term inside log message or module'),
                limit: z.number().optional().describe('Maximum number of log entries to return (default: 5)'),
            }),
            execute: async ({ level = 'all', query, limit = 5 }) => {
                const toolCallId = `call_${Date.now()}_log`;
                onToolEvent?.({ toolCallId, toolName: 'querySystemLogs', status: 'start', args: { level, query, limit } });
                let results = mockLogs;
                if (level !== 'all') {
                    results = results.filter((log) => log.level === level);
                }
                if (query) {
                    const q = query.toLowerCase();
                    results = results.filter((log) => log.message.toLowerCase().includes(q) || log.module.toLowerCase().includes(q));
                }
                const trimmed = results.slice(-limit);
                const output = {
                    count: trimmed.length,
                    logs: trimmed,
                };
                onToolEvent?.({ toolCallId, toolName: 'querySystemLogs', status: 'complete', result: output });
                return output;
            },
        }),
        saveNote: tool({
            description: 'Save a quick note, reminder, or task to local storage during the voice conversation.',
            parameters: z.object({
                noteText: z.string().describe('The content of the note or reminder to store'),
                category: z.string().optional().describe('Optional category e.g., task, meeting, reminder, idea'),
            }),
            execute: async ({ noteText, category = 'general' }) => {
                const toolCallId = `call_${Date.now()}_note`;
                onToolEvent?.({ toolCallId, toolName: 'saveNote', status: 'start', args: { noteText, category } });
                const newNote = {
                    id: `note-${inMemoryNotes.length + 1}`,
                    text: noteText,
                    category,
                    createdAt: new Date().toLocaleTimeString(),
                };
                inMemoryNotes.push(newNote);
                const result = {
                    success: true,
                    savedNote: newNote,
                    totalNotes: inMemoryNotes.length,
                };
                onToolEvent?.({ toolCallId, toolName: 'saveNote', status: 'complete', result });
                return result;
            },
        }),
        listNotes: tool({
            description: 'List existing notes, reminders, or saved items.',
            parameters: z.object({
                category: z.string().optional().describe('Filter notes by category'),
            }),
            execute: async ({ category }) => {
                const toolCallId = `call_${Date.now()}_list_notes`;
                onToolEvent?.({ toolCallId, toolName: 'listNotes', status: 'start', args: { category } });
                const notes = category ? inMemoryNotes.filter((n) => n.category?.toLowerCase() === category.toLowerCase()) : inMemoryNotes;
                const result = {
                    count: notes.length,
                    notes,
                };
                onToolEvent?.({ toolCallId, toolName: 'listNotes', status: 'complete', result });
                return result;
            },
        }),
    };
};
