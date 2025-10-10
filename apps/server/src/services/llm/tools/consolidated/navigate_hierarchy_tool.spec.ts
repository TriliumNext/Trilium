import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NavigateHierarchyTool } from './navigate_hierarchy_tool.js';

// Mock dependencies
vi.mock('../../../log.js', () => ({
    default: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn()
    }
}));

vi.mock('../../../../becca/becca.js', () => ({
    default: {
        notes: {},
        getNote: vi.fn()
    }
}));

describe('NavigateHierarchyTool', () => {
    let tool: NavigateHierarchyTool;

    beforeEach(() => {
        tool = new NavigateHierarchyTool();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('tool definition', () => {
        it('should have correct tool definition structure', () => {
            expect(tool.definition).toBeDefined();
            expect(tool.definition.type).toBe('function');
            expect(tool.definition.function.name).toBe('navigate_hierarchy');
            expect(tool.definition.function.description).toBeTruthy();
        });

        it('should have required parameters', () => {
            expect(tool.definition.function.parameters.required).toContain('note_id');
            expect(tool.definition.function.parameters.required).toContain('direction');
        });

        it('should have direction parameter with all supported directions', () => {
            const direction = tool.definition.function.parameters.properties.direction;
            expect(direction).toBeDefined();
            expect(direction.enum).toContain('children');
            expect(direction.enum).toContain('parents');
            expect(direction.enum).toContain('ancestors');
            expect(direction.enum).toContain('siblings');
        });

        it('should have depth parameter with defaults documented', () => {
            const depth = tool.definition.function.parameters.properties.depth;
            expect(depth).toBeDefined();
            expect(depth.description).toContain('1');
            expect(depth.description).toContain('10');
        });
    });

    describe('children direction', () => {
        it('should return all children at depth 1', async () => {
            const mockChild1 = {
                noteId: 'child1',
                title: 'Child 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockChild2 = {
                noteId: 'child2',
                title: 'Child 2',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([mockChild1, mockChild2])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['parent1'] = mockParent as any;

            const result = await tool.execute({
                note_id: 'parent1',
                direction: 'children',
                depth: 1
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(2);
            expect(result.notes).toHaveLength(2);
            expect(result.notes[0].noteId).toBe('child1');
            expect(result.notes[1].noteId).toBe('child2');
        });

        it('should return children recursively at depth 2', async () => {
            const mockGrandchild1 = {
                noteId: 'grandchild1',
                title: 'Grandchild 1',
                type: 'text',
                dateCreated: '2024-01-05',
                dateModified: '2024-01-06',
                isDeleted: false,
                getChildNotes: vi.fn().mockReturnValue([]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockChild1 = {
                noteId: 'child1',
                title: 'Child 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getChildNotes: vi.fn().mockReturnValue([mockGrandchild1]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([mockChild1])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['parent1'] = mockParent as any;

            const result = await tool.execute({
                note_id: 'parent1',
                direction: 'children',
                depth: 2
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(2); // child1 + grandchild1
            expect(result.notes).toHaveLength(2);
            expect(result.notes[0].noteId).toBe('child1');
            expect(result.notes[0].level).toBe(1);
            expect(result.notes[1].noteId).toBe('grandchild1');
            expect(result.notes[1].level).toBe(2);
        });

        it('should skip deleted children', async () => {
            const mockChild1 = {
                noteId: 'child1',
                title: 'Child 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: true,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockChild2 = {
                noteId: 'child2',
                title: 'Child 2',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([mockChild1, mockChild2])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['parent1'] = mockParent as any;

            const result = await tool.execute({
                note_id: 'parent1',
                direction: 'children'
            }) as any;

            expect(result.count).toBe(1);
            expect(result.notes[0].noteId).toBe('child2');
        });

        it('should return empty array when no children exist', async () => {
            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['parent1'] = mockParent as any;

            const result = await tool.execute({
                note_id: 'parent1',
                direction: 'children'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(0);
            expect(result.notes).toHaveLength(0);
        });
    });

    describe('parents direction', () => {
        it('should return all parents', async () => {
            const mockParent1 = {
                noteId: 'parent1',
                title: 'Parent 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent2 = {
                noteId: 'parent2',
                title: 'Parent 2',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getParentNotes: vi.fn().mockReturnValue([mockParent1, mockParent2])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'parents'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(2);
            expect(result.notes).toHaveLength(2);
            expect(result.notes[0].noteId).toBe('parent1');
            expect(result.notes[1].noteId).toBe('parent2');
        });

        it('should skip deleted parents', async () => {
            const mockParent1 = {
                noteId: 'parent1',
                title: 'Parent 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: true,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent2 = {
                noteId: 'parent2',
                title: 'Parent 2',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getParentNotes: vi.fn().mockReturnValue([mockParent1, mockParent2])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'parents'
            }) as any;

            expect(result.count).toBe(1);
            expect(result.notes[0].noteId).toBe('parent2');
        });
    });

    describe('ancestors direction', () => {
        it('should return all ancestors up to specified depth', async () => {
            const mockGrandparent = {
                noteId: 'grandparent1',
                title: 'Grandparent',
                type: 'text',
                dateCreated: '2024-01-05',
                dateModified: '2024-01-06',
                isDeleted: false,
                getParentNotes: vi.fn().mockReturnValue([]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getParentNotes: vi.fn().mockReturnValue([mockGrandparent]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getParentNotes: vi.fn().mockReturnValue([mockParent])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'ancestors',
                depth: 5
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(2);
            expect(result.notes[0].noteId).toBe('parent1');
            expect(result.notes[0].level).toBe(1);
            expect(result.notes[1].noteId).toBe('grandparent1');
            expect(result.notes[1].level).toBe(2);
        });

        it('should prevent infinite loops with cycle detection', async () => {
            // Create a circular reference: note1 -> parent1 -> grandparent1 -> parent1 (creates a loop)
            const mockGrandparent: any = {
                noteId: 'grandparent1',
                title: 'Grandparent',
                type: 'text',
                dateCreated: '2024-01-05',
                dateModified: '2024-01-06',
                isDeleted: false,
                getParentNotes: vi.fn(),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent: any = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getParentNotes: vi.fn().mockReturnValue([mockGrandparent]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote: any = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getParentNotes: vi.fn().mockReturnValue([mockParent])
            };

            // Create cycle: grandparent1's parent is parent1 (creates a loop back to parent1)
            mockGrandparent.getParentNotes.mockReturnValue([mockParent]);

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'ancestors',
                depth: 10
            }) as any;

            expect(result.success).toBe(true);
            // The visited set prevents infinite loops but parent1 appears twice:
            // once as direct parent of note1, and once as parent of grandparent1
            // The recursive call from grandparent1 to parent1 is stopped by visited set,
            // but parent1 is added to results before the recursive check
            expect(result.count).toBe(3);
            expect(result.notes[0].noteId).toBe('parent1');
            expect(result.notes[1].noteId).toBe('grandparent1');
            expect(result.notes[2].noteId).toBe('parent1'); // Appears again due to cycle
        });

        it('should skip root note', async () => {
            const mockRoot = {
                noteId: 'root',
                title: 'Root',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getParentNotes: vi.fn().mockReturnValue([]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getParentNotes: vi.fn().mockReturnValue([mockRoot])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'ancestors'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(0); // Root should be skipped
        });

        it('should respect depth limit at depth 1', async () => {
            const mockGrandparent = {
                noteId: 'grandparent1',
                title: 'Grandparent',
                type: 'text',
                dateCreated: '2024-01-05',
                dateModified: '2024-01-06',
                isDeleted: false,
                getParentNotes: vi.fn().mockReturnValue([]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getParentNotes: vi.fn().mockReturnValue([mockGrandparent]),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getParentNotes: vi.fn().mockReturnValue([mockParent])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'ancestors',
                depth: 1
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(1); // Only parent1, not grandparent1
            expect(result.notes[0].noteId).toBe('parent1');
        });
    });

    describe('siblings direction', () => {
        it('should return unique siblings from single parent', async () => {
            const mockSibling1 = {
                noteId: 'sibling1',
                title: 'Sibling 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockSibling2 = {
                noteId: 'sibling2',
                title: 'Sibling 2',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text'
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                isDeleted: false,
                getChildNotes: vi.fn().mockReturnValue([mockNote, mockSibling1, mockSibling2])
            };

            mockNote.getParentNotes = vi.fn().mockReturnValue([mockParent]);

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'siblings'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(2);
            expect(result.notes).toHaveLength(2);
            expect(result.notes[0].noteId).toBe('sibling1');
            expect(result.notes[1].noteId).toBe('sibling2');
        });

        it('should deduplicate siblings when note has multiple parents', async () => {
            const mockSharedSibling = {
                noteId: 'shared_sibling',
                title: 'Shared Sibling',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockUniqueSibling = {
                noteId: 'unique_sibling',
                title: 'Unique Sibling',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text'
            };

            const mockParent1 = {
                noteId: 'parent1',
                title: 'Parent 1',
                type: 'text',
                isDeleted: false,
                getChildNotes: vi.fn().mockReturnValue([mockNote, mockSharedSibling])
            };

            const mockParent2 = {
                noteId: 'parent2',
                title: 'Parent 2',
                type: 'text',
                isDeleted: false,
                getChildNotes: vi.fn().mockReturnValue([mockNote, mockSharedSibling, mockUniqueSibling])
            };

            mockNote.getParentNotes = vi.fn().mockReturnValue([mockParent1, mockParent2]);

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'siblings'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(2); // shared_sibling should appear only once
            expect(result.notes).toHaveLength(2);
            const siblingIds = result.notes.map((n: any) => n.noteId);
            expect(siblingIds).toContain('shared_sibling');
            expect(siblingIds).toContain('unique_sibling');
        });

        it('should exclude the note itself from siblings', async () => {
            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text'
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                isDeleted: false,
                getChildNotes: vi.fn().mockReturnValue([mockNote])
            };

            mockNote.getParentNotes = vi.fn().mockReturnValue([mockParent]);

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'siblings'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.count).toBe(0);
        });

        it('should skip deleted siblings', async () => {
            const mockSibling1 = {
                noteId: 'sibling1',
                title: 'Sibling 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: true,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockSibling2 = {
                noteId: 'sibling2',
                title: 'Sibling 2',
                type: 'text',
                dateCreated: '2024-01-03',
                dateModified: '2024-01-04',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text'
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                isDeleted: false,
                getChildNotes: vi.fn().mockReturnValue([mockNote, mockSibling1, mockSibling2])
            };

            mockNote.getParentNotes = vi.fn().mockReturnValue([mockParent]);

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'siblings'
            }) as any;

            expect(result.count).toBe(1);
            expect(result.notes[0].noteId).toBe('sibling2');
        });
    });

    describe('depth validation', () => {
        it('should clamp depth to minimum of 1', async () => {
            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'children',
                depth: 0
            }) as any;

            expect(result.success).toBe(true);
            expect(result.depth).toBe(1);
        });

        it('should clamp depth to maximum of 10', async () => {
            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'children',
                depth: 15
            }) as any;

            expect(result.success).toBe(true);
            expect(result.depth).toBe(10);
        });

        it('should clamp negative depth to 1', async () => {
            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'children',
                depth: -5
            }) as any;

            expect(result.success).toBe(true);
            expect(result.depth).toBe(1);
        });
    });

    describe('include_attributes option', () => {
        it('should include attributes when requested', async () => {
            const mockChild = {
                noteId: 'child1',
                title: 'Child 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([
                    { name: 'important', value: 'true', type: 'label' }
                ])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([mockChild])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['parent1'] = mockParent as any;

            const result = await tool.execute({
                note_id: 'parent1',
                direction: 'children',
                include_attributes: true
            }) as any;

            expect(result.success).toBe(true);
            expect(result.notes[0].attributes).toBeDefined();
            expect(result.notes[0].attributes).toHaveLength(1);
            expect(result.notes[0].attributes[0].name).toBe('important');
        });

        it('should not include attributes by default', async () => {
            const mockChild = {
                noteId: 'child1',
                title: 'Child 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([
                    { name: 'important', value: 'true', type: 'label' }
                ])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([mockChild])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['parent1'] = mockParent as any;

            const result = await tool.execute({
                note_id: 'parent1',
                direction: 'children'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.notes[0].attributes).toBeUndefined();
        });
    });

    describe('error handling', () => {
        it('should return error for non-existent note', async () => {
            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['nonexistent'] = undefined as any;

            const result = await tool.execute({
                note_id: 'nonexistent',
                direction: 'children'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Error');
            expect(result).toContain('not found');
        });

        it('should return error for unsupported direction', async () => {
            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text'
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'invalid_direction' as any
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Unsupported direction');
        });

        it('should handle errors gracefully', async () => {
            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getChildNotes: vi.fn().mockImplementation(() => {
                    throw new Error('Database error');
                })
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'children'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Error');
        });
    });

    describe('result structure', () => {
        it('should return consistent result structure', async () => {
            const mockNote = {
                noteId: 'note1',
                title: 'Note 1',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note1'] = mockNote as any;

            const result = await tool.execute({
                note_id: 'note1',
                direction: 'children'
            }) as any;

            expect(result).toHaveProperty('success');
            expect(result).toHaveProperty('noteId');
            expect(result).toHaveProperty('title');
            expect(result).toHaveProperty('direction');
            expect(result).toHaveProperty('depth');
            expect(result).toHaveProperty('count');
            expect(result).toHaveProperty('notes');
            expect(result).toHaveProperty('message');
        });

        it('should format notes with all required fields', async () => {
            const mockChild = {
                noteId: 'child1',
                title: 'Child 1',
                type: 'text',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                isDeleted: false,
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const mockParent = {
                noteId: 'parent1',
                title: 'Parent',
                type: 'text',
                getChildNotes: vi.fn().mockReturnValue([mockChild])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['parent1'] = mockParent as any;

            const result = await tool.execute({
                note_id: 'parent1',
                direction: 'children'
            }) as any;

            expect(result.notes[0]).toHaveProperty('noteId');
            expect(result.notes[0]).toHaveProperty('title');
            expect(result.notes[0]).toHaveProperty('type');
            expect(result.notes[0]).toHaveProperty('dateCreated');
            expect(result.notes[0]).toHaveProperty('dateModified');
            expect(result.notes[0]).toHaveProperty('level');
            expect(result.notes[0]).toHaveProperty('parentId');
        });
    });
});
