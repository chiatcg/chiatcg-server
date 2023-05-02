import { appraiseCard } from './appraise';
import { IAuthProvider, IDataSource } from './dependencies';

export const toClientPlayer = (player: IDataSource.IPlayer, authProvider: IAuthProvider) => {
    return {
        ...player,
        authToken: authProvider.getAuthTokenForPlayer(player),
    };
}

export const toClientDeck = (deck: IDataSource.ICardDeck | null) => {
    if (!deck) return null;
    return {
        id: deck.createdAt,
        cards: deck.cards.map(appraiseCard),
    };
};