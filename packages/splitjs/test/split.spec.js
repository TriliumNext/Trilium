/* eslint-env jasmine */
/* global Split */
/* eslint-disable no-var, func-names, prefer-arrow-callback, object-shorthand, prefer-template */

function calcParts(expr) {
    var re = /calc\(([\d]*\.?[\d]*?)%\s?-\s?([\d]+)px\)/
    var m = re.exec(expr)

    return {
        percentage: parseFloat(m[1]),
        pixels: parseInt(m[2], 10),
    }
}

describe('Split', function() {
    beforeEach(function() {
        document.body.style.width = '800px'
        document.body.style.height = '600px'

        this.a = document.createElement('div')
        this.b = document.createElement('div')
        this.c = document.createElement('div')

        this.a.id = 'a'
        this.b.id = 'b'
        this.c.id = 'c'

        document.body.appendChild(this.a)
        document.body.appendChild(this.b)
        document.body.appendChild(this.c)
    })

    afterEach(function() {
        document.body.removeChild(this.a)
        document.body.removeChild(this.b)
        document.body.removeChild(this.c)
    })

    it('splits in two when given two elements', function() {
        Split(['#a', '#b'])

        expect(this.a.style.width).toContain('calc(50% - 5px)')
        expect(this.b.style.width).toContain('calc(50% - 5px)')
    })

    it('splits in three when given three elements', function() {
        Split(['#a', '#b', '#c'])

        expect(calcParts(this.a.style.width).percentage).toBeCloseTo(33.33)
        expect(calcParts(this.b.style.width).percentage).toBeCloseTo(33.33)
        expect(calcParts(this.c.style.width).percentage).toBeCloseTo(33.33)

        expect(calcParts(this.a.style.width).pixels).toBe(5)
        expect(calcParts(this.b.style.width).pixels).toBe(10)
        expect(calcParts(this.c.style.width).pixels).toBe(5)
    })

    it('splits vertically when direction is vertical', function() {
        Split(['#a', '#b'], {
            direction: 'vertical',
        })

        expect(this.a.style.height).toContain('calc(50% - 5px)')
        expect(this.b.style.height).toContain('calc(50% - 5px)')
    })

    it('splits in percentages when given sizes', function() {
        Split(['#a', '#b'], {
            sizes: [25, 75],
        })

        expect(this.a.style.width).toContain('calc(25% - 5px)')
        expect(this.b.style.width).toContain('calc(75% - 5px)')
    })

    it('splits in percentages when given sizes', function() {
        Split(['#a', '#b'], {
            sizes: [25, 75],
        })

        expect(this.a.style.width).toContain('calc(25% - 5px)')
        expect(this.b.style.width).toContain('calc(75% - 5px)')
    })

    it('accounts for gutter size', function() {
        Split(['#a', '#b'], {
            gutterSize: 20,
        })

        expect(this.a.style.width).toContain('calc(50% - 10px)')
        expect(this.b.style.width).toContain('calc(50% - 10px)')
    })

    it('accounts for gutter size with more than two elements', function() {
        Split(['#a', '#b', '#c'], {
            gutterSize: 20,
        })

        expect(calcParts(this.a.style.width).percentage).toBeCloseTo(33.33)
        expect(calcParts(this.b.style.width).percentage).toBeCloseTo(33.33)
        expect(calcParts(this.c.style.width).percentage).toBeCloseTo(33.33)

        expect(calcParts(this.a.style.width).pixels).toBe(10)
        expect(calcParts(this.b.style.width).pixels).toBe(20)
        expect(calcParts(this.c.style.width).pixels).toBe(10)
    })

    it('accounts for gutter size when direction is vertical', function() {
        Split(['#a', '#b'], {
            direction: 'vertical',
            gutterSize: 20,
        })

        expect(this.a.style.height).toContain('calc(50% - 10px)')
        expect(this.b.style.height).toContain('calc(50% - 10px)')
    })

    it('accounts for gutter size with more than two elements when direction is vertical', function() {
        Split(['#a', '#b', '#c'], {
            direction: 'vertical',
            gutterSize: 20,
        })

        expect(calcParts(this.a.style.height).percentage).toBeCloseTo(33.33)
        expect(calcParts(this.b.style.height).percentage).toBeCloseTo(33.33)
        expect(calcParts(this.c.style.height).percentage).toBeCloseTo(33.33)

        expect(calcParts(this.a.style.height).pixels).toBe(10)
        expect(calcParts(this.b.style.height).pixels).toBe(20)
        expect(calcParts(this.c.style.height).pixels).toBe(10)
    })

    it('set size directly when given css values', function() {
        Split(['#a', '#b'], {
            sizes: ['150px', '640px'],
        })

        expect(this.a.style.width).toBe('150px')
        expect(this.b.style.width).toBe('640px')
    })

    it('adjusts sizes using setSizes', function() {
        var split = Split(['#a', '#b'])

        split.setSizes([70, 30])

        expect(this.a.style.width).toContain('calc(70% - 5px)')
        expect(this.b.style.width).toContain('calc(30% - 5px)')
    })

    it('collapse splits', function() {
        var split = Split(['#a', '#b'])

        split.collapse(0)

        expect(this.a.getBoundingClientRect().width).toBeCloseTo(100, 0)
        expect(this.b.getBoundingClientRect().width).toBeCloseTo(800 - 100 - 10, 0)

        split.collapse(1)

        expect(this.a.getBoundingClientRect().width).toBeCloseTo(800 - 100 - 10, 0)
        expect(this.b.getBoundingClientRect().width).toBeCloseTo(100, 0)
    })

    it('returns sizes', function() {
        var split = Split(['#a', '#b'])
        var sizes = split.getSizes()

        expect(sizes).toEqual([50, 50])

        split.setSizes([70, 30])

        sizes = split.getSizes()

        expect(sizes).toEqual([70, 30])
    })

    it('sets element styles using the elementStyle function', function() {
        Split(['#a', '#b'], {
            elementStyle: function(dimension, size) {
                return {
                    width: size + '%',
                }
            },
        })

        expect(this.a.style.width).toBe('50%')
        expect(this.b.style.width).toBe('50%')
    })
})
