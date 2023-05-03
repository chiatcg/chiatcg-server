import { appraiseCard } from '../appraise';
import { ExtDeps } from '../external-dependencies';
import { IHttpRouteHandler, StatusCodes } from "../net-utils";

export const createCardsHandler = (): IHttpRouteHandler => {
    return async (path, query) => {
        const id = path[0];
        if (id) {
            if (id.startsWith('xch1') || id.startsWith('did:chia:1')) {
                return _handleCardsDidOrXch(id, query.ct as string, +(query.count || 5));
            }

            if (id.startsWith('nft1')) {
                return _handleCardsNft(id);
            }
        }
        return [StatusCodes.badRequest, { reason: 'invalid id' }];
    };


    async function _handleCardsNft(nftId: string): Promise<ReturnType<IHttpRouteHandler>> {
        const resp = await ExtDeps.getNft(nftId);
        if (resp?.nft) {
            return [StatusCodes.ok, {
                card: {
                    ...appraiseCard({ nftId: resp.nft.nftId, mintHeight: resp.nft.firstBlock, url: resp.nft.urls[0] || '' }),
                    urls: resp.nft.urls,
                },
            }];
        }
        return [StatusCodes.notFound, { reason: 'nft not found' }];
    }

    async function _handleCardsDidOrXch(did: string, ct?: string, count = 5): Promise<ReturnType<IHttpRouteHandler>> {
        const resp = await ExtDeps.getNftsByDidOrWallet(did, count, ct);
        if (resp?.nfts.length) {
            return [StatusCodes.ok, {
                cards: resp.nfts.map(nft => ({
                    ...appraiseCard({ nftId: nft.nftId, mintHeight: nft.firstBlock, url: nft.urls[0] || '' }),
                    urls: nft.urls,
                })),
                ct: resp.ct,
            }];
        }

        return [StatusCodes.notFound, { reason: 'no nfts found' }];
    }
}