import { randomInt } from 'crypto';
import { appraiseCard } from '../appraise';

const excludedChars = ['1', 'b', 'i', 'o'];
const testSize = 1000000;

function generateId() {
    let id = 'nft1'.padEnd(54, '_');
    while (id.length < 62) {
        const i = randomInt(0, 36);
        let c: string;
        if (i >= 10) {
            c = String.fromCharCode(97 + i - 10);
        } else {
            c = String.fromCharCode(48 + i);
        }

        if (!excludedChars.includes(c)) {
            id += c;
        }
    }
    id = id.substring(0, 55) + (Math.random() < 0.5 ? 's' : 'q') + id.substring(56);
    return id;
}

test('appraiseCard', () => {
    const results = {
        factions: {
            backdoor: 0,
            bruteforce: 0,
            malware: 0,
        },
        scripts: {
            bd_exploit: 0,
            bd_decode: 0,
            bd_secure: 0,
            bf_firewall: 0,
            bf_obfuscate: 0,
            bf_spam: 0,
            mw_forward: 0,
            mw_freeware: 0,
            mw_worm: 0,
        },
        tiers: [0, 0, 0, 0, 0, 0, 0],
        cpu: 0,
        mem: 0,
    };

    for (let i = 0; i < testSize; i++) {
        const card = appraiseCard({ nftId: generateId(), mintHeight: 1, url: '' });
        results.factions[card.faction]++;
        results.tiers[card.tier]++;
        results.cpu += card.cpu;
        results.mem += card.mem;
        results.scripts[card.coreScript]++;

        if (card.cpu + card.mem !== card.tier + 2) {
            // This assertion is not done using expect() as it would slow down the test too much
            throw new Error('CPU + MEM is expected to be Tier + 2');
        }
    }

    expect(results.factions.bruteforce / results.factions.malware).toBeCloseTo(1, 1);
    expect(results.factions.bruteforce / results.factions.backdoor).toBeCloseTo(1.1, 1);
    expect(results.cpu / results.mem).toBeCloseTo(1);

    expect(results.scripts.bd_decode / results.scripts.bd_exploit).toBeCloseTo(1, 1);
    expect(results.scripts.bd_decode / results.scripts.bd_secure).toBeCloseTo(1, 1);
    expect(results.scripts.bf_firewall / results.scripts.bf_obfuscate).toBeCloseTo(1, 1);
    expect(results.scripts.bf_firewall / results.scripts.bf_spam).toBeCloseTo(1, 1);
    expect(results.scripts.mw_forward / results.scripts.mw_freeware).toBeCloseTo(1, 1);
    expect(results.scripts.mw_forward / results.scripts.mw_worm).toBeCloseTo(1, 1);

    expect(results.tiers[1]! / testSize).toBeCloseTo(.46156);
    expect(results.tiers[2]! / testSize).toBeCloseTo(.31667);
    expect(results.tiers[3]! / testSize).toBeCloseTo(.16521);
    expect(results.tiers[4]! / testSize).toBeCloseTo(.04849);
    expect(results.tiers[5]! / testSize).toBeCloseTo(.00759, 3);
    // Cannot reliably test T6 as the numbers are so small but if T1-T5 pass then by process of elimination we can assert T6 is correct
});