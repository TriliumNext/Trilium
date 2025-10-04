import { describe, it, expect } from 'vitest';

// Mock the EditableTextTypeWidget class to test the escaping methods
class MockEditableTextTypeWidget {
    private escapeGenericTypeSyntax(content: string): string {
        if (!content) return content;
        
        try {
            // Count replacements for debugging
            let replacementCount = 0;
            
            // List of known HTML tags that should NOT be escaped
            const htmlTags = new Set([
                // Block elements
                'div', 'p', 'section', 'article', 'nav', 'header', 'footer', 'aside', 'main',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li', 'dl', 'dt', 'dd',
                'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
                'form', 'fieldset', 'legend',
                'blockquote', 'pre', 'figure', 'figcaption',
                'address', 'hr', 'br',
                
                // Inline elements
                'span', 'a', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
                'small', 'mark', 'sub', 'sup',
                'code', 'kbd', 'samp', 'var',
                'q', 'cite', 'abbr', 'dfn', 'time',
                'img', 'picture', 'source',
                
                // Form elements
                'input', 'textarea', 'button', 'select', 'option', 'optgroup',
                'label', 'output', 'progress', 'meter',
                
                // Media elements
                'audio', 'video', 'track',
                'canvas', 'svg',
                
                // Metadata elements
                'head', 'title', 'meta', 'link', 'style', 'script', 'noscript',
                'base',
                
                // Document structure
                'html', 'body',
                
                // Other common elements
                'iframe', 'embed', 'object', 'param',
                'details', 'summary', 'dialog',
                'template', 'slot',
                'area', 'map',
                'ruby', 'rt', 'rp',
                'bdi', 'bdo', 'wbr',
                'data', 'datalist',
                'keygen', 'output',
                'math', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace',
                
                // Custom elements that Trilium uses
                'includenote'
            ]);
            
            // More comprehensive escaping strategy:
            // We'll use a different approach - parse through the content and identify
            // what looks like HTML vs what looks like generic type syntax
            
            // First pass: Protect actual HTML tags by temporarily replacing them
            const htmlProtectionMap = new Map<string, string>();
            let protectionCounter = 0;
            
            // Protect complete HTML tags (opening, closing, and self-closing)
            content = content.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s+[^>]*)?\/?>|<!--[\s\S]*?-->/g, (match, tagName) => {
                // Check if this is a comment
                if (match.startsWith('<!--')) {
                    const placeholder = `__HTML_PROTECTED_${protectionCounter++}__`;
                    htmlProtectionMap.set(placeholder, match);
                    return placeholder;
                }
                
                // Extract just the tag name (first word after < or </)
                const actualTagName = tagName?.toLowerCase();
                
                // Only protect if it's a known HTML tag
                if (actualTagName && htmlTags.has(actualTagName)) {
                    const placeholder = `__HTML_PROTECTED_${protectionCounter++}__`;
                    htmlProtectionMap.set(placeholder, match);
                    return placeholder;
                }
                
                // Not a known HTML tag, leave it for escaping
                return match;
            });
            
            // Second pass: Now escape all remaining angle brackets that weren't protected
            // These are likely generic type syntax or other non-HTML patterns
            content = content.replace(/</g, () => {
                replacementCount++;
                return '&lt;';
            });
            content = content.replace(/>/g, () => {
                replacementCount++;
                return '&gt;';
            });
            
            // Third pass: Restore the protected HTML tags
            htmlProtectionMap.forEach((originalHtml, placeholder) => {
                content = content.replace(placeholder, originalHtml);
            });
            
            return content;
        } catch (error) {
            return content;
        }
    }
    
    private unescapeGenericTypeSyntax(content: string): string {
        if (!content) return content;
        
        // Simply replace all &lt; with < and &gt; with >
        // This is the correct behavior because CKEditor expects raw HTML
        // Any entities that should display as literal text need to be double-escaped
        content = content.replace(/&lt;/g, '<');
        content = content.replace(/&gt;/g, '>');
        
        return content;
    }
    
    testEscape(content: string): string {
        return this.escapeGenericTypeSyntax(content);
    }
    
    testUnescape(content: string): string {
        return this.unescapeGenericTypeSyntax(content);
    }
}

describe('EditableTextTypeWidget - Generic Type Escaping', () => {
    const widget = new MockEditableTextTypeWidget();
    
    it('should escape generic type syntax with comma after tag name', () => {
        const input = '<PhaseType,';
        const expected = '&lt;PhaseType,';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should escape generic type syntax with two type parameters', () => {
        const input = '<String, PromptTemplate>';
        const expected = '&lt;String, PromptTemplate&gt;';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should escape nested generic types', () => {
        const input = 'HashMap<String, List<Item>>';
        const expected = 'HashMap&lt;String, List&lt;Item&gt;&gt;';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should not escape valid HTML tags', () => {
        const input = '<div class="test">content</div>';
        const expected = '<div class="test">content</div>';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should not escape HTML tags with attributes containing commas', () => {
        const input = '<div data-values="1,2,3">content</div>';
        const expected = '<div data-values="1,2,3">content</div>';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should handle mixed content with both generics and HTML', () => {
        const input = 'Code: <String, Type> and HTML: <div>content</div>';
        const expected = 'Code: &lt;String, Type&gt; and HTML: <div>content</div>';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should properly unescape escaped content', () => {
        const testCases = [
            '<String, PromptTemplate>',
            '<PhaseType,',
            '<RiskLevel, f32>',
            'HashMap<String, List<Item>>',
            'Mixed: <String, Type> and <div>HTML</div>'
        ];
        
        testCases.forEach(original => {
            const escaped = widget.testEscape(original);
            const unescaped = widget.testUnescape(escaped);
            expect(unescaped).toBe(original);
        });
    });
    
    it('should handle empty or null content', () => {
        expect(widget.testEscape('')).toBe('');
        expect(widget.testUnescape('')).toBe('');
    });
    
    it('should handle content with multiple generic patterns', () => {
        const input = `
            pub struct LlmService {
                anthropic_client: Option<AnthropicClient>,
                openai_client: Option<OpenAIClient>,
                templates: HashMap<String, PromptTemplate>,
            }
        `;
        
        const escaped = widget.testEscape(input);
        expect(escaped).toContain('Option&lt;AnthropicClient&gt;');
        expect(escaped).toContain('Option&lt;OpenAIClient&gt;');
        expect(escaped).toContain('HashMap&lt;String, PromptTemplate&gt;');
        expect(escaped).not.toContain('Option<AnthropicClient>');
        
        const unescaped = widget.testUnescape(escaped);
        expect(unescaped).toBe(input);
    });
    
    // Additional test cases for problematic patterns
    it('should escape Rust Box<dyn patterns', () => {
        const input = 'Box<dyn';
        const expected = 'Box&lt;dyn';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should escape Rust trait object syntax', () => {
        const input = 'Box<dyn Error>';
        const expected = 'Box&lt;dyn Error&gt;';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should escape complex Rust trait bounds', () => {
        const input = 'Box<dyn Error + Send + Sync>';
        const expected = 'Box&lt;dyn Error + Send + Sync&gt;';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should escape incomplete generic syntax with string', () => {
        const input = '<string,';
        const expected = '&lt;string,';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should escape C++ style templates', () => {
        const testCases = [
            { input: 'std::vector<int>', expected: 'std::vector&lt;int&gt;' },
            { input: 'std::map<string, vector<int>>', expected: 'std::map&lt;string, vector&lt;int&gt;&gt;' },
            { input: 'unique_ptr<Widget>', expected: 'unique_ptr&lt;Widget&gt;' }
        ];
        
        testCases.forEach(({ input, expected }) => {
            expect(widget.testEscape(input)).toBe(expected);
        });
    });
    
    it('should handle edge cases with standalone angle brackets', () => {
        const testCases = [
            { input: '<', expected: '&lt;' },
            { input: '>', expected: '&gt;' },
            { input: '< >', expected: '&lt; &gt;' },
            { input: '<>', expected: '&lt;&gt;' },
            { input: '<<>>', expected: '&lt;&lt;&gt;&gt;' },
            { input: 'a < b && c > d', expected: 'a &lt; b && c &gt; d' }
        ];
        
        testCases.forEach(({ input, expected }) => {
            expect(widget.testEscape(input)).toBe(expected);
        });
    });
    
    it('should preserve HTML comments', () => {
        const input = '<!-- This is a comment with <generics> -->';
        const expected = '<!-- This is a comment with <generics> -->';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should handle pre-escaped content correctly', () => {
        // If content already has HTML entities, they get preserved during escaping
        // (they don't match our angle bracket patterns)
        const input = 'Already escaped: &lt;String&gt; and new: <Integer>';
        const expected = 'Already escaped: &lt;String&gt; and new: &lt;Integer&gt;';
        expect(widget.testEscape(input)).toBe(expected);
        
        // When unescaping, ALL &lt; and &gt; entities get unescaped
        // This is correct behavior because CKEditor expects raw HTML
        const unescaped = widget.testUnescape(expected);
        expect(unescaped).toBe('Already escaped: <String> and new: <Integer>');
    });
    
    it('should handle HTML with inline code containing generics', () => {
        const input = '<p>Use <code>Vec<T></code> for dynamic arrays</p>';
        const expected = '<p>Use <code>Vec&lt;T&gt;</code> for dynamic arrays</p>';
        expect(widget.testEscape(input)).toBe(expected);
    });
    
    it('should handle self-closing HTML tags', () => {
        const input = '<img src="test.jpg" /><br/><CustomType>';
        const expected = '<img src="test.jpg" /><br/>&lt;CustomType&gt;';
        expect(widget.testEscape(input)).toBe(expected);
    });
});