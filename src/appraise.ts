const MINT_HEIGHT_THRESHOLD = 3200000;

export type CoreScriptNames = typeof _CoreScriptNames[IAppraisedCard['faction']][number];

export interface IAppraisedCard {
    nftId: string;
    faction: 'backdoor' | 'bruteforce' | 'malware';
    coreScript: CoreScriptNames;
    tier: number;
    cpu: number;
    mem: number;
    url: string;
}

/**
 * Generates card stats based on the number of digits in the last 9 chars of the nftId,
 */
export const appraiseCard = ({ nftId, mintHeight, url }: { nftId: string, mintHeight: number, url: string }): IAppraisedCard => {
    // Last 9 chars of the nftId determine the card qualifier, Q
    const Q = nftId.substring(nftId.length - 8).split('');

    // Q[0] determines faction
    //   Since 34 potential characters does not divide cleanly by 3 factions,
    //   distribution will not come out even - Backdoor will appear 10% less than other factions
    let faction: IAppraisedCard['faction'];
    const factionQualifier = Q[0]!.charCodeAt(0);
    if (factionQualifier < 99) faction = 'backdoor'; // 0-9, a, b (10 chars, '1' and 'b' do not exist)
    else if (factionQualifier < 111) faction = 'bruteforce'; // c-n (11 chars, 'i' does not exist)
    else faction = 'malware'; // o-z (11 chars, 'o' does not exist)

    // The sum of the char codes of Q, sumQ, determines faction core script
    const sumQ = Q.reduce((sum, c) => sum + c.charCodeAt(0), 0);
    const coreScripts = _CoreScriptNames[faction];
    const coreScript = coreScripts[sumQ % coreScripts.length]!;

    // Q[2:] is the card statistics qualifier, SQ, each granted statistic increases card tier
    const SQ = Q.slice(2);
    const tier = SQ.reduce((sum, c) => isNaN(+c) ? sum : (sum + 1), 0);
    if (tier < 2 || mintHeight >= MINT_HEIGHT_THRESHOLD) {
        // Less than 2 digits or minted after threshold is a T1; either 1/2 or 2/1
        const singleQualifier = Q[1]; // Only either 's' or 'q'
        const cpu = singleQualifier === 's' ? 2 : 1;
        const mem = 3 - cpu;
        return {
            nftId,
            faction,
            tier: 1,
            cpu,
            mem,
            coreScript,
            url,
        };
    }

    // For each character c in SQ, grant CPU or MEM if c is numeric, nothing otherwise
    //   Since there are only 9 possible digits per character, we use 2-5 for MEM, 6-9 for CPU, 0 is treated special
    let cpu = 1;
    let mem = 1;
    for (const c of SQ) {
        if (+c > 5) {
            cpu++; // 6, 7, 8, 9
        } else if (+c > 0) {
            mem++; // 2, 3, 4, 5 ('1' does not exist)
        } else if (+c === 0) {
            // For 0, we flip a coin on the char code sum of Q which results in 50:50 CPU:MEM distribution
            (sumQ % 2) ? (cpu++) : (mem++);
        }
    }

    return {
        nftId,
        faction,
        tier,
        cpu,
        mem,
        coreScript,
        url,
    };
};

const _CoreScriptNames = {
    backdoor: [
        'bd_exploit',
        'bd_decode',
        'bd_secure',
    ] as const,

    bruteforce: [
        'bf_firewall',
        'bf_obfuscate',
        'bf_spam',
    ] as const,

    malware: [
        'mw_forward',
        'mw_freeware',
        'mw_worm',
    ] as const,
};
(_CoreScriptNames as Record<IAppraisedCard['faction'], readonly string[]>);
