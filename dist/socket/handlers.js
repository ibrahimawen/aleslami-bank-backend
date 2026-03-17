import { Server as SocketIOServer } from 'socket.io';
import { queryAll, queryOne } from '../db/instance.js';
function computeKPIs() {
    const query = 'SELECT * FROM transactions';
    const records = queryAll(query);
    const totalTransactions = records.length;
    const totalAmount = records.reduce((sum, r) => sum + (r.amount_requested || 0), 0);
    const pendingCount = records.filter(r => r.computed_status === 'pending' ||
        r.computed_status === 'approved' ||
        r.computed_status === 'charged').length;
    const completedCount = records.filter(r => r.computed_status === 'completed').length;
    const failedCount = records.filter(r => r.computed_status === 'rejected' ||
        r.computed_status === 'insufficient' ||
        r.computed_status === 't24_error').length;
    const rateResult = queryOne('SELECT AVG(transfer_exchange_rate) as avg FROM transactions WHERE transfer_exchange_rate IS NOT NULL AND transfer_exchange_rate > 0');
    const avgExchangeRate = rateResult?.avg || 0;
    const totalProfit = records.reduce((sum, r) => {
        if (r.deposit_type === 'transfer' && r.amount_requested && r.final_amount) {
            return sum + (r.final_amount - r.amount_requested);
        }
        return sum;
    }, 0);
    return {
        totalTransactions,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        pendingCount,
        completedCount,
        failedCount,
        avgExchangeRate: parseFloat(avgExchangeRate.toFixed(4)),
        totalProfit: parseFloat(totalProfit.toFixed(2)),
    };
}
export function setupSocketIO(httpServer, corsOrigins) {
    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: corsOrigins || ['http://localhost:5173', 'http://127.0.0.1:5173'],
            credentials: true,
        },
    });
    io.on('connection', (socket) => {
        console.log('Client connected:', socket.id);
        // Send initial KPI snapshot
        const initialKPIs = computeKPIs();
        socket.emit('kpi-snapshot', initialKPIs);
        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });
    // Broadcast KPIs every 30 seconds
    setInterval(() => {
        const kpis = computeKPIs();
        io.emit('kpi-update', kpis);
    }, 30000);
    return io;
}
export default setupSocketIO;
