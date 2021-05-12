class Texture {

    /**
     * Creates a texture
     * @param {object} options
     * @param {string} options.source
     */
    constructor(options = {}) {
        this.context = null;
        this.imageData = null;
        this.loaded = new Promise((resolve, reject) => {
            const image = new Image();
            image.src = options.source;
            image.onload = () => { this._onLoad(image); resolve(); };
            image.onerror = () => reject();
        });
    }

    get width() { return this.imageData.width; }
    get height() { return this.imageData.height; }

    /**
     * @param {Image} image 
     */
    _onLoad(image) {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;

        this.context = canvas.getContext('2d');
        this.context.drawImage(image, 0, 0);
        this.imageData = this.context.getImageData(0, 0, image.width, image.height);
    }

    /**
     * Changes every pixel with a non-zero alpha to the given color
     * @param {number[]} color 
     */
    flood(color) {
        if (color.length == 3) color = [...color, 255];
        for (let i = 0; i < this.imageData.data.length; i += 4) {
            if (this.imageData.data[i + 3] == 0) continue;
            this.imageData.data[i + 0] = color[0];
            this.imageData.data[i + 1] = color[1];
            this.imageData.data[i + 2] = color[2];
            this.imageData.data[i + 3] = color[3];
        }
        this.context.putImageData(this.imageData, 0, 0);
    }

    /**
     * @returns {string} The base64 encoded image
     */
    encode() {
        return this.context.canvas.toDataURL();
    }

}

class BitmapFont {

    /**
     * Creates a bitmap font
     * @param {object} options
     * @param {string} options.source
     */
    constructor(options) {
        this.face = null;
        this.lineHeight = 0;
        this.padding = [0, 0, 0, 0];
        this.spacing = [0, 0];
        this.atlases = {};
        this.glyphs = {};
        this._color = [255, 255, 255, 255];
        this.loaded = new Promise(resolve => {
            const source = options.source;
            const parent = source.substr(0, source.lastIndexOf('/') + 1);
            fetch(source).then(response => response.text()).then(data => {
                const lines = data.split('\n');
                return lines.map(line => {
                    const pieces = line.trim().split(/\s+/);
                    const command = { type: pieces.shift() };
                    pieces.forEach(piece => {
                        const splitIndex = piece.indexOf('=');
                        const components = [piece.slice(0, splitIndex), piece.slice(splitIndex + 1)];
                        command[components[0]] = components[1];
                    });
                    return command;
                });
            }).then(commands => {
                commands.forEach(command => {
                    switch (command.type) {
                        case 'info':
                            this.face = command.face;
                            this.padding = command.padding.split(',').map(parseFloat);
                            this.spacing = command.spacing.split(',').map(parseFloat);
                            break;
                        case 'common':
                            this.lineHeight = parseFloat(command.lineHeight);
                            break;
                        case 'page':
                            const id = parseFloat(command.id);
                            this.atlases[id] = new Texture({ source: parent + eval(command.file) });
                            break;
                        case 'char':
                            const character = parseFloat(command.id);
                            this.glyphs[character] = {
                                x: parseFloat(command.x),
                                y: parseFloat(command.y),
                                width: parseFloat(command.width),
                                height: parseFloat(command.height),
                                xOffset: parseFloat(command.xoffset),
                                yOffset: parseFloat(command.yoffset),
                                xAdvance: parseFloat(command.xadvance),
                                atlas: parseFloat(command.page)
                            };
                            break;
                        default:
                            break;
                    }
                });
            }).then(() => Promise.all(Object.values(this.atlases).map(atlas => atlas.loaded))).then(resolve);
        });
    }

    set color(color) {
        if (this._color === color) return;
        Object.values(this.atlases).forEach(atlas => atlas.flood(color));
        this._color = color;
    }

    get color() {
        return this._color;
    }

    /**
     * Retrieves the glyph information for a given character code
     * @param {number} characterCode The code of the character glyph to retreive
     * @returns {object} The glyph information
     */
    getGlyph(characterCode) {
        return this.glyphs[characterCode];
    }

    /**
     * Checks to see if this font supports a given character code
     * @param {number} characterCode The code of the character to check for support
     */
    isSupported(characterCode) {
        return characterCode in this.glyphs;
    }

}

function scrapeTextNodes(element) {
    const textNodes = [];
    for (const node of element.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
            textNodes.push(node);
        } else if (node instanceof HTMLElement) {
            textNodes.push(...scrapeTextNodes(node));
        }
    }
    return textNodes;
}

async function createLettering(text, font, scale, color) {
    let elements = [];
    for (const character of text) {
        const code = character.charCodeAt();
        if (font.isSupported(code)) {
            const glyph = font.getGlyph(code);
            const glyphElement = document.createElement('span');
            const atlas = font.atlases[glyph.atlas];
            atlas.flood(color);
            glyphElement.innerText = character;
            glyphElement.style.width = glyph.width * scale + 'px';
            glyphElement.style.height = glyph.height * scale + 'px';
            glyphElement.style.marginRight = (glyph.xAdvance - glyph.width) * scale + 'px';
            glyphElement.style.marginTop = glyph.yOffset * scale + 'px';
            glyphElement.style.transform = `translateX(${glyph.xOffset * scale}px)`;
            glyphElement.style.backgroundImage = `url(${atlas.encode()})`;
            glyphElement.style.backgroundSize = `${atlas.width * scale}px ${atlas.height * scale}px`;
            glyphElement.style.backgroundPositionX = -glyph.x * scale + 'px';
            glyphElement.style.backgroundPositionY = -glyph.y * scale + 'px';
            glyphElement.style.imageRendering = 'pixelated';
            glyphElement.style.verticalAlign = 'middle';
            glyphElement.style.display = 'inline-block';
            glyphElement.style.color = 'transparent';
            elements.push(glyphElement);
        }
    }
    return elements;
}

async function applyFont(element, font) {
    const textNodes = scrapeTextNodes(element);
    for (const textNode of textNodes) {
        const style = getComputedStyle(textNode.parentElement);
        const color = style.color.match(/[0-9]+/g).map(parseFloat);
        const fontSize = parseFloat(style.fontSize);
        const scale = Math.round(fontSize / font.lineHeight);
        console.dir(textNode.parentElement.innerText);
        const lettering = await createLettering(textNode.textContent, font, scale, color);
        for (const letter of lettering) {
            textNode.before(letter);
        }
        textNode.remove();
    }
}

window.addEventListener('load', async () => {
    const elements = document.querySelectorAll('[bitmap-font]');
    for (const element of elements) {
        const font = new BitmapFont({ source: element.getAttribute('bitmap-font') });
        await font.loaded;
        applyFont(element, font);
    }
});