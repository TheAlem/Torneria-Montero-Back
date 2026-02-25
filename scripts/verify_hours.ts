
import { businessSecondsBetween } from '../src/services/SemaforoService';

const shifts = [
    { startMin: 8 * 60, endMin: 12 * 60 },      // 08:00 - 12:00
    { startMin: 13 * 60, endMin: 18 * 60 }      // 13:00 - 18:00
];

function test(name: string, start: string, end: string, expectedMinutes: number) {
    const s = new Date(start);
    const e = new Date(end);
    const sec = businessSecondsBetween(s, e, shifts);
    const min = Math.round(sec / 60);

    if (Math.abs(min - expectedMinutes) <= 1) {
        console.log(`[PASS] ${name}: Got ${min} min (Expected ${expectedMinutes})`);
    } else {
        console.error(`[FAIL] ${name}: Got ${min} min (Expected ${expectedMinutes})`);
    }
}

console.log('--- Verifying Business Hours Calculation ---');

// Case 1: Within morning shift
test('Morning Block', '2025-01-23T09:00:00', '2025-01-23T11:00:00', 120);

// Case 2: Crossing Lunch (11:30 - 13:30)
// 11:30-12:00 (30m) + 12:00-13:00 (0m) + 13:00-13:30 (30m) = 60m
test('Lunch Crossing', '2025-01-23T11:30:00', '2025-01-23T13:30:00', 60);

// Case 3: Overnight (17:00 - 09:00 Next Day)
// 17:00-18:00 (60m) + Night (0m) + 08:00-09:00 (60m) = 120m
test('Overnight', '2025-01-23T17:00:00', '2025-01-24T09:00:00', 120);

// Case 4: Weekend (Friday 17:00 to Monday 09:00) 
// Assume Sat is workday in default, but let's see. 
// Default uses "1-6" (Mon-Sat). So Sat is work.
// Let's test Sat evening to Mon morning. 
// Sat 17:00 - Mon 09:00.
// Sat 17:00-18:00 (60m). Sun (0m). Mon 08:00-09:00 (60m) = 120m.
test('Weekend (Sat-Mon)', '2025-01-25T17:00:00', '2025-01-27T09:00:00', 120);
