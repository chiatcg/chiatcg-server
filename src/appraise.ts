export type CoreScriptNames = typeof _CoreScriptNames[IAppraisedCard['faction']][number];

export interface IAppraisedCard {
    nftId: string;
    faction: 'backdoor' | 'bruteforce' | 'malware';
    coreScript: CoreScriptNames;
    tier: number;
    cpu: number;
    mem: number;
    url?: string;
}

export const appraiseCard = ({ nftId, url }: { nftId: string, url: string }): IAppraisedCard => {
    /**
     * Generates card stats based on the number of digits in the last 8 chars of the nftId,
     * see probability breakdown below:
     * 8 - 0.0035%, 1 in 28,211
     * 7 - 0.0737%, 1 in  1,356
     * 6 - 0.6708%, 1 in    149
     * 5 - 3.4888%, 1 in     29
     * 4 - 11.338%, 1 in      9
     * 3 - 23.584%, 1 in      4
     * 2 - 30.660%, 1 in      3
     * 1 - 22.776%, 1 in      4
     * 0 - 7.4023%, 1 in     14
     * 0-1 account for 30% of all ids (T1)
     */

    // Last 8 chars of the nftId determine the card qualifier, Q
    const Q = nftId.substring(nftId.length - 8).split('');

    // Q[0] determines faction
    let faction: IAppraisedCard['faction'];
    const factionQualifier = Q[0]!.charCodeAt(0);
    if (factionQualifier < 99) faction = 'backdoor'; // 0-9, a, b (12 chars)
    else if (factionQualifier < 111) faction = 'bruteforce'; // c-n (12 chars)
    else faction = 'malware'; // o-z (12 chars)

    // Q[1] determines faction core script
    const coreScripts = _CoreScriptNames[faction];
    const coreScript = coreScripts[Q[1]!.charCodeAt(0) % coreScripts.length]!;

    // Q[2:] is the card statistics qualifier, SQ, each granted statistic increases card tier
    const SQ = Q.slice(2);
    const tier = SQ.reduce((sum, c) => isNaN(+c) ? sum : (sum + 1), 0);
    if (tier < 2) {
        // Less than 2 digits is a T1; either 1/2 or 2/1
        const singleQualifier = nftId.charCodeAt(nftId.length - 1);
        const cpu = singleQualifier <= 104 ? 2 : 1;
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

    // For each character c in SQ, grant CPU if c > 5, MEM c <= 5, nothing otherwise
    let cpu = 1;
    let mem = 1
    for (const c of SQ) {
        if (+c > 5) cpu++;
        else if (+c <= 5) mem++;
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
