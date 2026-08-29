export class MenuItem {
    constructor(label, onClick) {
        this.label = label;
        this.onClick = onClick;
    }
    render(menuInstance) {
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
    render() {
        const sep = document.createElement("div");
        sep.className = "context-menu-separator";
        return sep;
    }
}
export class ContextMenu {
    constructor() {
        this.items = [];
        this.container = document.createElement("div");
        this.container.className = "context-menu";
        this.container.style.display = "none";
        document.body.appendChild(this.container);
        document.addEventListener("click", () => this.hide(), true);
    }
    addItem(item) {
        this.items.push(item);
    }
    createRadioOption(groupLabel, options, currentKey, onSelect) {
        this.addItem(new MenuItem(groupLabel, () => { }));
        Object.entries(options).forEach(([css, label]) => {
            const isSelected = (css === currentKey);
            this.addItem(new MenuItem(label + (isSelected ? " ●" : ""), () => { onSelect(css); }));
        });
        this.addItem(new Separator());
    }
    show(x, y) {
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
//# sourceMappingURL=context-menu.js.map