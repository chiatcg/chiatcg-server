///<reference lib='dom' />

export namespace ExtDeps {
    export interface INft {
        nftId: string;
        wallet: string;
        firstBlock: number;
        lastBlock: number;
        urls: string[];
        did?: string;
    }

    export interface IDidProof {
        latestCoinId: string;
        pubkey: string;
        signature: string;
    };

    export async function getNft(nftId: string) {
        try {
            const resp = await fetch('https://api.chiapi.io/v0/nfts/' + nftId);
            if (resp.ok) {
                return await resp.json() as { nft: INft };
            }
        } catch {
        }
        return null;
    }

    export async function getNftsByDidOrWallet(didOrWallet: string, count?: number, ct?: string) {
        try {
            const queryParams = [count && `count=${count}`, ct && `ct=${ct}`].filter(Boolean);
            const query = queryParams.length ? `?${queryParams.join('&')}` : '';

            const resp = await fetch(`https://api.chiapi.io/v0/nfts/${didOrWallet}${query}`);
            return await resp.json() as { nfts: INft[], ct?: string };
        } catch {
        }
        return null;
    }

    export async function verifyDidProof(proof: IDidProof) {
        try {
            const resp = await fetch(`https://api.chiapi.io/v0/dids/verify`, {
                method: 'POST',
                body: JSON.stringify({ proof }),
                headers: {
                    'content-type': 'application/json',
                },
            });
            return await resp.json() as { did: string };
        } catch {
        }
        return null;
    }
}