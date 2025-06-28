import {
    IHeaderParams,
    IHeaderComp,
} from 'ag-grid-community';

export default class TableAddColumnButton implements IHeaderComp {
    private eGui!: HTMLElement;
    private params!: IHeaderParams;

    public init(params: IHeaderParams): void {
        this.params = params;

        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.justifyContent = 'space-between';
        container.style.alignItems = 'center';

        const label = document.createElement('span');
        label.innerText = params.displayName;

        const button = document.createElement('button');
        button.textContent = '+';
        button.title = 'Add Row';
        button.onclick = () => {
            alert(`Add row for column: ${params.displayName}`);
            // Optionally trigger insert logic here
        };

        container.appendChild(label);
        container.appendChild(button);

        this.eGui = container;
    }

    public getGui(): HTMLElement {
        return this.eGui;
    }

    refresh(params: IHeaderParams): boolean {
        return false;
    }

    public destroy(): void {
        // Optional: clean up if needed
    }
}
