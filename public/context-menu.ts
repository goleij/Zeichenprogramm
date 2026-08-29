export class MenuItem {
    constructor(public label: string, public onClick: (menuInstance: ContextMenu) => void) {}
    render(menuInstance: ContextMenu): HTMLElement {
        const item = document.createElement("div");
        item.className = "context-menu-item";
        item.textContent = this.label;
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            this.onClick(menuInstance);
            menuInstance.hide();
        });
        return item;
    }
}

export class Separator {
    render(): HTMLElement {
        const sep = document.createElement("div");
        sep.className = "context-menu-separator";
        return sep;
    }
}

export class ContextMenu {
    items: (MenuItem | Separator)[] = [];
    container: HTMLElement;

    constructor() {
        this.container = document.createElement("div");
        this.container.className = "context-menu";
        this.container.style.display = "none";
        document.body.appendChild(this.container);

        document.addEventListener("click", () => this.hide(), true);
    }

    addItem(item: MenuItem | Separator) {
        this.items.push(item);
    }

        createRadioOption(
        groupLabel: string,
        options: { [cssKey: string]: string },
        currentKey: string | null,
        onSelect: (cssKey: string) => void
    ): void {

        this.addItem(new MenuItem(groupLabel, () => {}));

        Object.entries(options).forEach(([css, label]) => {
            const isSelected = (css === currentKey);
            this.addItem(
                new MenuItem(
                    label + (isSelected ? " ●" : ""),
                    () => { onSelect(css); }
                )
            );
        });

        this.addItem(new Separator());
    }

    show(x: number, y: number) {
        this.container.innerHTML = "";
        this.items.forEach(item => {
            this.container.appendChild(item.render(this));
        });
        this.container.style.left = `${x}px`;
        this.container.style.top = `${y}px`;
        this.container.style.display = "block";
    }

    hide() {
        this.container.style.display = "none";
    }
}
