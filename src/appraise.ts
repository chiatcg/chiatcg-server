import { ExtDeps } from './external-dependencies';

export type ScriptName = typeof _ScriptNames[IAppraisedCard['faction']][number];
export type ModName = typeof _ModNames[number];

export interface IAppraisedCard {
    nftId: string;
    faction: 'red' | 'green' | 'blue';
    scripts: ScriptName[];
    tier: number;
    cpu: number;
    mem: number;
    url?: string;
}

export const appraiseCard = (nft: ExtDeps.INft): IAppraisedCard => {
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

    const nftId = nft.nftId;

    // Last 9 chars of the nftId determine the card qualifier, Q
    const Q = nftId.substring(nftId.length - 9).split('');

    // Q[0] determines faction
    let faction: IAppraisedCard['faction'] = 'red';
    const factionQualifier = Q[0]!.charCodeAt(0);
    if (factionQualifier < 99) faction = 'blue';
    else if (factionQualifier < 111) faction = 'red';
    else faction = 'green';

    // Q[1:] determine tier, one tier level per digit
    const tier = Q.slice(1).reduce((sum, c) => isNaN(+c) ? sum : (sum + 1), 0);
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
            scripts: [_ScriptNames[faction][0]],
            url: nft.urls[0],
        };
    }

    // Q[1:7] determine cpu and mem, high digits increase cpu, low digits increase mem
    const cpuMemQualifier = Q.slice(1, 7);
    const cpu = cpuMemQualifier.reduce((sum, c) => +c > 5 ? (sum + 1) : sum, 1);
    const mem = cpuMemQualifier.reduce((sum, c) => +c <= 5 ? (sum + 1) : sum, 1);

    // Q[7:] determine abilities, each digit gives one ability
    const extraFactionScriptQualifier = Q[7]!;
    //const extraNeutralScriptQualifier = Q[8];

    return {
        nftId,
        faction,
        tier,
        cpu,
        mem,
        scripts: [
            _ScriptNames[faction][0],
            genExtraFactionScript(faction, extraFactionScriptQualifier),
            // genExtraNeutralScript(extraNeutralScriptQualifier),
        ].filter(Boolean),
        url: nft.urls[0],
    };
};

const genExtraFactionScript = (faction: IAppraisedCard['faction'], _quality: string) => {
    const scriptName = _ScriptNames[faction];
    return scriptName[1 + (_quality.charCodeAt(0) % (scriptName.length - 1))]!;
}

const _ScriptNames = {
    blue: [
        'bd_backdoor',
        'bd_disconnect',
        'bd_disrupt',
        'bd_feedback',
        'bd_reboot',
        'bd_tunnel',
    ] as const,

    green: [
        'mw_malware',
        'mw_phishing',
        'mw_shareware',
        'mw_freeware',
        'mw_spoof',
    ] as const,

    red: [
        'bf_bruteforce',
        'bf_flood',
        'bf_ddos',
        'bf_multicast',
        'bf_obfuscate',
    ] as const,
};
(_ScriptNames as Record<IAppraisedCard['faction'], readonly string[]>);

const _ModNames = [
    'backdoor',
    'feedback',
    'freeze',
    'scriptCooldown',
    'stun',
    'winOnDeath',
] as const;