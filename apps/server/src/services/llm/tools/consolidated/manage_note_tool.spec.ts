import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ManageNoteTool } from './manage_note_tool.js';

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

vi.mock('../../../notes.js', () => ({
    default: {
        createNewNote: vi.fn()
    }
}));

vi.mock('../../../attributes.js', () => ({
    default: {
        createLabel: vi.fn(),
        createRelation: vi.fn(),
        createAttribute: vi.fn()
    }
}));

vi.mock('../../../cloning.js', () => ({
    default: {
        cloneNoteToParentNote: vi.fn()
    }
}));

describe('ManageNoteTool', () => {
    let tool: ManageNoteTool;

    beforeEach(() => {
        tool = new ManageNoteTool();
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('tool definition', () => {
        it('should have correct tool definition structure', () => {
            expect(tool.definition).toBeDefined();
            expect(tool.definition.type).toBe('function');
            expect(tool.definition.function.name).toBe('manage_note');
            expect(tool.definition.function.description).toBeTruthy();
        });

        it('should have action parameter with all supported actions', () => {
            const action = tool.definition.function.parameters.properties.action;
            expect(action).toBeDefined();
            expect(action.enum).toContain('read');
            expect(action.enum).toContain('create');
            expect(action.enum).toContain('update');
            expect(action.enum).toContain('delete');
            expect(action.enum).toContain('move');
            expect(action.enum).toContain('clone');
            expect(action.enum).toContain('add_attribute');
            expect(action.enum).toContain('remove_attribute');
            expect(action.enum).toContain('add_relation');
            expect(action.enum).toContain('remove_relation');
        });

        it('should require action parameter', () => {
            expect(tool.definition.function.parameters.required).toContain('action');
        });

        it('should have all 17 Trilium note types in note_type enum', () => {
            const noteType = tool.definition.function.parameters.properties.note_type;
            expect(noteType).toBeDefined();
            expect(noteType.enum).toBeDefined();
            expect(noteType.enum).toHaveLength(17);

            // Verify all official Trilium note types are present
            const expectedTypes = [
                'text', 'code', 'file', 'image', 'search', 'noteMap',
                'relationMap', 'launcher', 'doc', 'contentWidget', 'render',
                'canvas', 'mermaid', 'book', 'webView', 'mindMap', 'aiChat'
            ];

            for (const type of expectedTypes) {
                expect(noteType.enum).toContain(type);
            }
        });

        it('should have default values for optional enum parameters', () => {
            const noteType = tool.definition.function.parameters.properties.note_type;
            expect(noteType.default).toBe('text');
            expect(noteType.enum).toContain(noteType.default);

            const updateMode = tool.definition.function.parameters.properties.update_mode;
            expect(updateMode.default).toBe('replace');
            expect(updateMode.enum).toContain(updateMode.default);
        });
    });

    describe('read action', () => {
        it('should read note successfully', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Test Note',
                type: 'text',
                mime: 'text/html',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                getContent: vi.fn().mockResolvedValue('Test content'),
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            const result = await tool.execute({
                action: 'read',
                note_id: 'test123'
            }) as any;

            expect(result.noteId).toBe('test123');
            expect(result.title).toBe('Test Note');
            expect(result.content).toBe('Test content');
        });

        it('should include attributes when requested', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Test Note',
                type: 'text',
                mime: 'text/html',
                dateCreated: '2024-01-01',
                dateModified: '2024-01-02',
                getContent: vi.fn().mockResolvedValue('Test content'),
                getOwnedAttributes: vi.fn().mockReturnValue([
                    { name: 'important', value: '', type: 'label' }
                ])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            const result = await tool.execute({
                action: 'read',
                note_id: 'test123',
                include_attributes: true
            }) as any;

            expect(result.attributes).toBeDefined();
            expect(result.attributes).toHaveLength(1);
        });

        it('should return error for non-existent note', async () => {
            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = undefined as any;

            const result = await tool.execute({
                action: 'read',
                note_id: 'test123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Error');
        });

        it('should require note_id parameter', async () => {
            const result = await tool.execute({ action: 'read' });

            expect(typeof result).toBe('string');
            expect(result).toContain('note_id is required');
        });
    });

    describe('create action', () => {
        it('should create note successfully', async () => {
            const notes = await import('../../../notes.js');
            const becca = await import('../../../../becca/becca.js');

            const mockParent = {
                noteId: 'root',
                title: 'Root'
            };
            vi.mocked(becca.default.getNote).mockReturnValue(mockParent as any);

            const mockNewNote = {
                noteId: 'new123',
                title: 'New Note'
            };
            vi.mocked(notes.default.createNewNote).mockReturnValue({ note: mockNewNote } as any);

            const result = await tool.execute({
                action: 'create',
                title: 'New Note',
                content: 'Test content'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.noteId).toBe('new123');
            expect(result.title).toBe('New Note');
        });

        it('should require title parameter', async () => {
            const result = await tool.execute({
                action: 'create',
                content: 'Test content'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('title is required');
        });

        it('should require content parameter', async () => {
            const result = await tool.execute({
                action: 'create',
                title: 'New Note'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('content is required');
        });

        it('should use root as default parent', async () => {
            const notes = await import('../../../notes.js');
            const becca = await import('../../../../becca/becca.js');

            const mockRoot = {
                noteId: 'root',
                title: 'Root'
            };
            vi.mocked(becca.default.getNote).mockReturnValue(mockRoot as any);

            const mockNewNote = { noteId: 'new123', title: 'New Note' };
            vi.mocked(notes.default.createNewNote).mockReturnValue({ note: mockNewNote } as any);

            await tool.execute({
                action: 'create',
                title: 'New Note',
                content: 'Test'
            });

            expect(notes.default.createNewNote).toHaveBeenCalledWith(
                expect.objectContaining({ parentNoteId: 'root' })
            );
        });

        it('should validate content size limit', async () => {
            const result = await tool.execute({
                action: 'create',
                title: 'Test Note',
                content: 'x'.repeat(10_000_001) // Exceeds 10MB limit
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('exceeds maximum size of 10MB');
            expect(result).toContain('Consider splitting into multiple notes');
        });

        it('should validate title length limit', async () => {
            const result = await tool.execute({
                action: 'create',
                title: 'x'.repeat(201), // Exceeds 200 char limit
                content: 'Test content'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('exceeds maximum length of 200 characters');
            expect(result).toContain('Please shorten the title');
        });

        it('should accept all valid note types', async () => {
            const notes = await import('../../../notes.js');
            const becca = await import('../../../../becca/becca.js');

            const mockRoot = {
                noteId: 'root',
                title: 'Root'
            };
            vi.mocked(becca.default.getNote).mockReturnValue(mockRoot as any);

            const mockNewNote = { noteId: 'new123', title: 'New Note' };
            vi.mocked(notes.default.createNewNote).mockReturnValue({ note: mockNewNote } as any);

            const validTypes = [
                'text', 'code', 'file', 'image', 'search', 'noteMap',
                'relationMap', 'launcher', 'doc', 'contentWidget', 'render',
                'canvas', 'mermaid', 'book', 'webView', 'mindMap', 'aiChat'
            ];

            for (const noteType of validTypes) {
                const result = await tool.execute({
                    action: 'create',
                    title: `Note of type ${noteType}`,
                    content: 'Test content',
                    note_type: noteType
                }) as any;

                expect(result.success).toBe(true);
                expect(result.type).toBe(noteType);
            }
        });
    });

    describe('update action', () => {
        it('should update note title', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Old Title',
                save: vi.fn(),
                getContent: vi.fn().mockResolvedValue('Content'),
                setContent: vi.fn()
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            const result = await tool.execute({
                action: 'update',
                note_id: 'test123',
                title: 'New Title'
            }) as any;

            expect(result.success).toBe(true);
            expect(mockNote.save).toHaveBeenCalled();
        });

        it('should update note content with replace mode', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Test',
                save: vi.fn(),
                getContent: vi.fn().mockResolvedValue('Old content'),
                setContent: vi.fn()
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            await tool.execute({
                action: 'update',
                note_id: 'test123',
                content: 'New content',
                update_mode: 'replace'
            });

            expect(mockNote.setContent).toHaveBeenCalledWith('New content');
        });

        it('should update note content with append mode', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Test',
                save: vi.fn(),
                getContent: vi.fn().mockResolvedValue('Old content'),
                setContent: vi.fn()
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            await tool.execute({
                action: 'update',
                note_id: 'test123',
                content: 'New content',
                update_mode: 'append'
            });

            expect(mockNote.setContent).toHaveBeenCalledWith('Old content\n\nNew content');
        });

        it('should require note_id parameter', async () => {
            const result = await tool.execute({
                action: 'update',
                title: 'New Title'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('note_id is required');
        });

        it('should require at least title or content', async () => {
            const result = await tool.execute({
                action: 'update',
                note_id: 'test123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('At least one of title or content');
        });
    });

    describe('attribute operations', () => {
        it('should add attribute successfully', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Test Note',
                getOwnedAttributes: vi.fn().mockReturnValue([])
            };

            const becca = await import('../../../../becca/becca.js');
            const attributes = await import('../../../attributes.js');

            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            const result = await tool.execute({
                action: 'add_attribute',
                note_id: 'test123',
                attribute_name: 'important',
                attribute_value: 'high'
            }) as any;

            expect(result.success).toBe(true);
            expect(attributes.default.createLabel).toHaveBeenCalled();
        });

        it('should prevent duplicate attributes', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Test Note',
                getOwnedAttributes: vi.fn().mockReturnValue([
                    { name: 'important', value: 'high' }
                ])
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            const result = await tool.execute({
                action: 'add_attribute',
                note_id: 'test123',
                attribute_name: 'important',
                attribute_value: 'high'
            }) as any;

            expect(result.success).toBe(false);
            expect(result.message).toContain('already exists');
        });

        it('should remove attribute successfully', async () => {
            const mockNote = {
                noteId: 'test123',
                title: 'Test Note',
                getOwnedAttributes: vi.fn().mockReturnValue([
                    {
                        attributeId: 'attr123',
                        noteId: 'test123',
                        name: 'important',
                        value: 'high',
                        type: 'label',
                        position: 0
                    }
                ])
            };

            const becca = await import('../../../../becca/becca.js');
            const attributes = await import('../../../attributes.js');

            vi.mocked(becca.default.notes)['test123'] = mockNote as any;

            const result = await tool.execute({
                action: 'remove_attribute',
                note_id: 'test123',
                attribute_name: 'important'
            }) as any;

            expect(result.success).toBe(true);
            expect(attributes.default.createAttribute).toHaveBeenCalled();
        });
    });

    describe('relation operations', () => {
        it('should add relation successfully', async () => {
            const mockSourceNote = {
                noteId: 'source123',
                title: 'Source Note',
                getRelationTargets: vi.fn().mockReturnValue([])
            };

            const mockTargetNote = {
                noteId: 'target123',
                title: 'Target Note'
            };

            const becca = await import('../../../../becca/becca.js');
            const attributes = await import('../../../attributes.js');

            vi.mocked(becca.default.notes)['source123'] = mockSourceNote as any;
            vi.mocked(becca.default.notes)['target123'] = mockTargetNote as any;

            const result = await tool.execute({
                action: 'add_relation',
                note_id: 'source123',
                relation_name: 'references',
                target_note_id: 'target123'
            }) as any;

            expect(result.success).toBe(true);
            expect(attributes.default.createRelation).toHaveBeenCalledWith(
                'source123',
                'references',
                'target123'
            );
        });

        it('should require target_note_id for add_relation', async () => {
            const result = await tool.execute({
                action: 'add_relation',
                note_id: 'test123',
                relation_name: 'references'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('target_note_id is required');
        });
    });

    describe('move action', () => {
        it('should move note successfully', async () => {
            const mockNote = {
                noteId: 'note123',
                title: 'Note to Move'
            };

            const mockParent = {
                noteId: 'parent123',
                title: 'New Parent'
            };

            const becca = await import('../../../../becca/becca.js');
            const cloningService = await import('../../../cloning.js');

            vi.mocked(becca.default.notes)['note123'] = mockNote as any;
            vi.mocked(becca.default.notes)['parent123'] = mockParent as any;
            vi.mocked(cloningService.default.cloneNoteToParentNote).mockReturnValue({
                branchId: 'branch123'
            } as any);

            const result = await tool.execute({
                action: 'move',
                note_id: 'note123',
                parent_note_id: 'parent123'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.noteId).toBe('note123');
            expect(result.newParentId).toBe('parent123');
            expect(result.branchId).toBe('branch123');
            expect(cloningService.default.cloneNoteToParentNote).toHaveBeenCalledWith(
                'note123',
                'parent123'
            );
        });

        it('should require note_id for move', async () => {
            const result = await tool.execute({
                action: 'move',
                parent_note_id: 'parent123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('note_id is required');
        });

        it('should require parent_note_id for move', async () => {
            const result = await tool.execute({
                action: 'move',
                note_id: 'note123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('parent_note_id is required');
        });

        it('should return error for non-existent note in move', async () => {
            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note123'] = undefined as any;

            const result = await tool.execute({
                action: 'move',
                note_id: 'note123',
                parent_note_id: 'parent123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('not found');
        });

        it('should return error for non-existent parent in move', async () => {
            const mockNote = {
                noteId: 'note123',
                title: 'Note to Move'
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note123'] = mockNote as any;
            vi.mocked(becca.default.notes)['parent123'] = undefined as any;

            const result = await tool.execute({
                action: 'move',
                note_id: 'note123',
                parent_note_id: 'parent123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Parent note');
            expect(result).toContain('not found');
        });
    });

    describe('clone action', () => {
        it('should clone note successfully', async () => {
            const mockNote = {
                noteId: 'note123',
                title: 'Note to Clone'
            };

            const mockParent = {
                noteId: 'parent123',
                title: 'Target Parent'
            };

            const becca = await import('../../../../becca/becca.js');
            const cloningService = await import('../../../cloning.js');

            vi.mocked(becca.default.notes)['note123'] = mockNote as any;
            vi.mocked(becca.default.notes)['parent123'] = mockParent as any;
            vi.mocked(cloningService.default.cloneNoteToParentNote).mockReturnValue({
                branchId: 'branch456'
            } as any);

            const result = await tool.execute({
                action: 'clone',
                note_id: 'note123',
                parent_note_id: 'parent123'
            }) as any;

            expect(result.success).toBe(true);
            expect(result.sourceNoteId).toBe('note123');
            expect(result.parentNoteId).toBe('parent123');
            expect(result.branchId).toBe('branch456');
            expect(cloningService.default.cloneNoteToParentNote).toHaveBeenCalledWith(
                'note123',
                'parent123'
            );
        });

        it('should require note_id for clone', async () => {
            const result = await tool.execute({
                action: 'clone',
                parent_note_id: 'parent123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('note_id is required');
        });

        it('should require parent_note_id for clone', async () => {
            const result = await tool.execute({
                action: 'clone',
                note_id: 'note123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('parent_note_id is required');
        });

        it('should return error for non-existent note in clone', async () => {
            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note123'] = undefined as any;

            const result = await tool.execute({
                action: 'clone',
                note_id: 'note123',
                parent_note_id: 'parent123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('not found');
        });

        it('should return error for non-existent parent in clone', async () => {
            const mockNote = {
                noteId: 'note123',
                title: 'Note to Clone'
            };

            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['note123'] = mockNote as any;
            vi.mocked(becca.default.notes)['parent123'] = undefined as any;

            const result = await tool.execute({
                action: 'clone',
                note_id: 'note123',
                parent_note_id: 'parent123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Parent note');
            expect(result).toContain('not found');
        });
    });

    describe('error handling', () => {
        it('should handle unknown action', async () => {
            const result = await tool.execute({
                action: 'unknown_action' as any
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Unsupported action');
        });

        it('should handle errors gracefully', async () => {
            const becca = await import('../../../../becca/becca.js');
            vi.mocked(becca.default.notes)['test123'] = {
                getContent: vi.fn().mockRejectedValue(new Error('Database error'))
            } as any;

            const result = await tool.execute({
                action: 'read',
                note_id: 'test123'
            });

            expect(typeof result).toBe('string');
            expect(result).toContain('Error');
        });
    });
});
