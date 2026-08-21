import { beforeEach, describe, expect, it, vi } from "vitest";

const serverMock = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    remove: vi.fn(),
    postWithSilentConflict: vi.fn(),
    putWithSilentConflict: vi.fn()
}));

vi.mock("./server", () => ({
    default: serverMock
}));

const flashcardsModule = await import("./flashcards");
const flashcards = flashcardsModule.default;
const { FlashcardConflictError } = flashcardsModule;

const schedulerConfig = {
    requestRetention: 0.85,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    weights: null
};

describe("flashcards client service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("calls flashcard endpoints with typed payloads", async () => {
        serverMock.post.mockResolvedValueOnce({ cardId: "card1" });
        serverMock.get
            .mockResolvedValueOnce({ decks: [] })
            .mockResolvedValueOnce({ cards: [], totalDueCount: 0 })
            .mockResolvedValueOnce({ cardId: "card1" })
            .mockResolvedValueOnce({ cardId: "card1", previews: [] })
            .mockResolvedValueOnce({ dueCount: 0 })
            .mockResolvedValueOnce({ schedulerConfig: { requestRetention: 0.9 } });
        serverMock.put.mockResolvedValueOnce({ schedulerConfig: { requestRetention: 0.85 } });
        serverMock.remove.mockResolvedValueOnce({ removedCount: 1 });

        await flashcards.createCard({ noteId: "note1", deckNoteId: "deck1" });
        await flashcards.getDecks();
        await flashcards.getDueCards({ deckNoteId: "deck 1", limit: 10 });
        await flashcards.getCard("card1");
        await flashcards.getPreview("card1");
        await flashcards.getStats();
        await flashcards.getSettings();
        await flashcards.setSettings({ schedulerConfig });
        await flashcards.removeCardsForNote("note1");

        expect(serverMock.post).toHaveBeenCalledWith("flashcards/cards", {
            noteId: "note1",
            deckNoteId: "deck1"
        });
        expect(serverMock.get).toHaveBeenNthCalledWith(1, "flashcards/decks");
        expect(serverMock.get).toHaveBeenNthCalledWith(
            2,
            "flashcards/due?deckNoteId=deck+1&limit=10"
        );
        expect(serverMock.get).toHaveBeenNthCalledWith(3, "flashcards/cards/card1");
        expect(serverMock.get).toHaveBeenNthCalledWith(4, "flashcards/cards/card1/preview");
        expect(serverMock.get).toHaveBeenNthCalledWith(5, "flashcards/stats");
        expect(serverMock.get).toHaveBeenNthCalledWith(6, "flashcards/settings");
        expect(serverMock.put).toHaveBeenCalledWith("flashcards/settings", { schedulerConfig });
        expect(serverMock.remove).toHaveBeenCalledWith("flashcards/notes/note1/cards");
    });

    it("uses silent conflict calls for scheduling mutations", async () => {
        serverMock.putWithSilentConflict
            .mockResolvedValueOnce({ card: { cardId: "card1" } })
            .mockResolvedValueOnce({ card: { cardId: "card1" } });
        serverMock.postWithSilentConflict
            .mockResolvedValueOnce({ card: { cardId: "card1" } })
            .mockResolvedValueOnce({ card: { cardId: "card1" } })
            .mockResolvedValueOnce({ card: { cardId: "card1" } })
            .mockResolvedValueOnce({ card: { cardId: "card1" }, reviewId: "review1" });

        await flashcards.setSuspended("card1", { suspended: true, expectedSchedulingRevision: 1 });
        await flashcards.moveCardToDeck("card1", { deckNoteId: "deck1", expectedSchedulingRevision: 2 });
        await flashcards.resetCard("card1", { expectedSchedulingRevision: 3 });
        await flashcards.buryCard("card1", { expectedSchedulingRevision: 4 });
        await flashcards.undoReview({ reviewId: "review1", expectedSchedulingRevision: 5 });
        await flashcards.reviewCard("card1", {
            rating: 3,
            expectedSchedulingRevision: 6,
            clientRequestId: "request1"
        });

        expect(serverMock.putWithSilentConflict).toHaveBeenNthCalledWith(
            1,
            "flashcards/cards/card1/suspended",
            { suspended: true, expectedSchedulingRevision: 1 }
        );
        expect(serverMock.putWithSilentConflict).toHaveBeenNthCalledWith(
            2,
            "flashcards/cards/card1/deck",
            { deckNoteId: "deck1", expectedSchedulingRevision: 2 }
        );
        expect(serverMock.postWithSilentConflict).toHaveBeenNthCalledWith(
            1,
            "flashcards/cards/card1/reset",
            { expectedSchedulingRevision: 3 }
        );
        expect(serverMock.postWithSilentConflict).toHaveBeenNthCalledWith(
            2,
            "flashcards/cards/card1/bury",
            { expectedSchedulingRevision: 4 }
        );
        expect(serverMock.postWithSilentConflict).toHaveBeenNthCalledWith(
            3,
            "flashcards/reviews/undo",
            { reviewId: "review1", expectedSchedulingRevision: 5 }
        );
        expect(serverMock.postWithSilentConflict).toHaveBeenNthCalledWith(
            4,
            "flashcards/cards/card1/reviews",
            { rating: 3, expectedSchedulingRevision: 6, clientRequestId: "request1" }
        );
    });

    it("maps 409 responses to flashcard conflict errors", async () => {
        serverMock.postWithSilentConflict.mockRejectedValueOnce({
            status: 409,
            responseText: JSON.stringify({ message: "Refresh before reviewing." })
        });

        await expect(flashcards.reviewCard("card1", {
            rating: 3,
            expectedSchedulingRevision: 1,
            clientRequestId: "request1"
        })).rejects.toMatchObject({
            name: "FlashcardConflictError",
            message: "Refresh before reviewing."
        });
        expect(FlashcardConflictError).toBeDefined();
    });
});
