export default function parents<T extends HTMLElement>(el: T, selector: string) {
    const result = [];
    for (let p = el && el.parentElement; p; p = p.parentElement) {
        if (p.matches(selector)) result.push(p);
    }
    return result;
}