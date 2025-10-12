function absoluteUrl(url) {
	if (!url) {
		return url;
	}

	const protocol = url.toLowerCase().split(':')[0];
	if (['http', 'https', 'file'].indexOf(protocol) >= 0) {
		return url;
	}

	if (url.indexOf('//') === 0) {
		return location.protocol + url;
	} else if (url[0] === '/') {
		return location.protocol + '//' + location.host + url;
	} else {
		return getBaseUrl() + '/' + url;
	}
}

function pageTitle() {
	const titleElements = document.getElementsByTagName("title");

	return titleElements.length ? titleElements[0].text.trim() : document.title.trim();
}

function getReadableDocument() {
	// Readability directly change the passed document, so clone to preserve the original web page.
	const documentCopy = document.cloneNode(true);
	const readability = new Readability(documentCopy, {
		serializer: el => el // so that .content is returned as DOM element instead of HTML
	});

	const article = readability.parse();

	if (!article) {
		throw new Error('Could not parse HTML document with Readability');
	}

	return {
		title: article.title,
		body: article.content,
	}
}

function getDocumentDates() {
	var dates = {
		publishedDate: null,
		modifiedDate: null,  
	};
	
	const articlePublishedTime = document.querySelector("meta[property='article:published_time']");
	if (articlePublishedTime && articlePublishedTime.getAttribute('content')) {
		dates.publishedDate = new Date(articlePublishedTime.getAttribute('content'));
	}
	
	const articleModifiedTime = document.querySelector("meta[property='article:modified_time']");
	if (articleModifiedTime && articleModifiedTime.getAttribute('content')) {
		dates.modifiedDate = new Date(articleModifiedTime.getAttribute('content'));
	}
	
	// TODO: if we didn't get dates from meta, then try to get them from JSON-LD

	return dates;
}

function getRectangleArea() {
	return new Promise((resolve, reject) => {
		const overlay = document.createElement('div');
		overlay.style.opacity = '0.6';
		overlay.style.background = 'black';
		overlay.style.width = '100%';
		overlay.style.height = '100%';
		overlay.style.zIndex = 99999999;
		overlay.style.top = 0;
		overlay.style.left = 0;
		overlay.style.position = 'fixed';

		document.body.appendChild(overlay);

		const messageComp = document.createElement('div');

		const messageCompWidth = 300;
		messageComp.setAttribute("tabindex", "0"); // so that it can be focused
		messageComp.style.position = 'fixed';
		messageComp.style.opacity = '0.95';
		messageComp.style.fontSize = '14px';
		messageComp.style.width = messageCompWidth + 'px';
		messageComp.style.maxWidth = messageCompWidth + 'px';
		messageComp.style.border = '1px solid black';
		messageComp.style.background = 'white';
		messageComp.style.color = 'black';
		messageComp.style.top = '10px';
		messageComp.style.textAlign = 'center';
		messageComp.style.padding = '10px';
		messageComp.style.left = Math.round(document.body.clientWidth / 2 - messageCompWidth / 2) + 'px';
		messageComp.style.zIndex = overlay.style.zIndex + 1;

		messageComp.textContent = 'Drag and release to capture a screenshot';

		document.body.appendChild(messageComp);

		const selection = document.createElement('div');
		selection.style.opacity = '0.5';
		selection.style.border = '1px solid red';
		selection.style.background = 'white';
		selection.style.border = '2px solid black';
		selection.style.zIndex = overlay.style.zIndex - 1;
		selection.style.top = 0;
		selection.style.left = 0;
		selection.style.position = 'fixed';

		document.body.appendChild(selection);

		messageComp.focus(); // we listen on keypresses on this element to cancel on escape

		let isDragging = false;
		let draggingStartPos = null;
		let selectionArea = {};

		function updateSelection() {
			selection.style.left = selectionArea.x + 'px';
			selection.style.top = selectionArea.y + 'px';
			selection.style.width = selectionArea.width + 'px';
			selection.style.height = selectionArea.height + 'px';
		}

		function setSelectionSizeFromMouse(event) {
			if (event.clientX < draggingStartPos.x) {
				selectionArea.x = event.clientX;
			}

			if (event.clientY < draggingStartPos.y) {
				selectionArea.y = event.clientY;
			}

			selectionArea.width = Math.max(1, Math.abs(event.clientX - draggingStartPos.x));
			selectionArea.height = Math.max(1, Math.abs(event.clientY - draggingStartPos.y));
			updateSelection();
		}

		function selection_mouseDown(event) {
			selectionArea = {x: event.clientX, y: event.clientY, width: 0, height: 0};
			draggingStartPos = {x: event.clientX, y: event.clientY};
			isDragging = true;
			updateSelection();
		}

		function selection_mouseMove(event) {
			if (!isDragging) return;
			setSelectionSizeFromMouse(event);
		}

		function removeOverlay() {
			isDragging = false;

			overlay.removeEventListener('mousedown', selection_mouseDown);
			overlay.removeEventListener('mousemove', selection_mouseMove);
			overlay.removeEventListener('mouseup', selection_mouseUp);

			document.body.removeChild(overlay);
			document.body.removeChild(selection);
			document.body.removeChild(messageComp);
		}

		function selection_mouseUp(event) {
			setSelectionSizeFromMouse(event);

			removeOverlay();

			console.info('selectionArea:', selectionArea);

			if (!selectionArea || !selectionArea.width || !selectionArea.height) {
				return;
			}

			// Need to wait a bit before taking the screenshot to make sure
			// the overlays have been removed and don't appear in the
			// screenshot. 10ms is not enough.
			setTimeout(() => resolve(selectionArea), 100);
		}

		function cancel(event) {
			if (event.key === "Escape") {
				removeOverlay();
			}
		}

		overlay.addEventListener('mousedown', selection_mouseDown);
		overlay.addEventListener('mousemove', selection_mouseMove);
		overlay.addEventListener('mouseup', selection_mouseUp);
		overlay.addEventListener('mouseup', selection_mouseUp);
		messageComp.addEventListener('keydown', cancel);
	});
}

function makeLinksAbsolute(container) {
	for (const link of container.getElementsByTagName('a')) {
		if (link.href) {
			link.href = absoluteUrl(link.href);
		}
	}
}

function getImages(container) {
	const images = [];

	for (const img of container.getElementsByTagName('img')) {
		if (!img.src) {
			continue;
		}

		const existingImage = images.find(image => image.src === img.src);

		if (existingImage) {
			img.src = existingImage.imageId;
		}
		else {
			const imageId = randomString(20);

			images.push({
				imageId: imageId,
				src: img.src
			});

			img.src = imageId;
		}
	}

	return images;
}

function createLink(clickAction, text, color = "lightskyblue") {
	const link = document.createElement('a');
	link.href = "javascript:";
	link.style.color = color;
	link.appendChild(document.createTextNode(text));
	link.addEventListener("click", () => {
		browser.runtime.sendMessage(null, clickAction)
	});

	return link
}

async function prepareMessageResponse(message) {
	console.info('Message: ' + message.name);

	if (message.name === "toast") {
		let messageText;

		if (message.noteId) {
			messageText = document.createElement('p');
			messageText.setAttribute("style", "padding: 0; margin: 0; font-size: larger;")
			messageText.appendChild(document.createTextNode(message.message + " "));
			messageText.appendChild(createLink(
				{name: 'openNoteInTrilium', noteId: message.noteId},
				"Open in Trilium."
			));

			// only after saving tabs
			if (message.tabIds) {
				messageText.appendChild(document.createElement("br"));
				messageText.appendChild(createLink(
					{name: 'closeTabs', tabIds: message.tabIds},
					"Close saved tabs.",
					"tomato"
				));
			}
		}
		else {
			messageText = message.message;
		}

		await requireLib('/lib/toast.js');

		showToast(messageText, {
			settings: {
				duration: 7000
			}
		});
	}
	else if (message.name === "trilium-save-selection") {
		const container = document.createElement('div');

		const selection = window.getSelection();

		for (let i = 0; i < selection.rangeCount; i++) {
			const range = selection.getRangeAt(i);

			container.appendChild(range.cloneContents());
		}

		makeLinksAbsolute(container);

		const images = getImages(container);

		return {
			title: pageTitle(),
			content: container.innerHTML,
			images: images,
			pageUrl: getPageLocationOrigin() + location.pathname + location.search + location.hash
		};

	}
	else if (message.name === 'trilium-get-rectangle-for-screenshot') {
		return getRectangleArea();
	}
	else if (message.name === "trilium-save-page") {
		await requireLib("/lib/JSDOMParser.js");
		await requireLib("/lib/Readability.js");
		await requireLib("/lib/Readability-readerable.js");

		const {title, body} = getReadableDocument();

		makeLinksAbsolute(body);

		const images = getImages(body);

        var labels = {};
		const dates = getDocumentDates();
		if (dates.publishedDate) {
			labels['publishedDate'] = dates.publishedDate.toISOString().substring(0, 10);
		}
		if (dates.modifiedDate) {
			labels['modifiedDate'] = dates.publishedDate.toISOString().substring(0, 10);
		}

		return {
			title: title,
			content: body.innerHTML,
			images: images,
			pageUrl: getPageLocationOrigin() + location.pathname + location.search,
			clipType: 'page',
			labels: labels
		};
	}
	else {
		throw new Error('Unknown command: ' + JSON.stringify(message));
	}
}

browser.runtime.onMessage.addListener(prepareMessageResponse);

const loadedLibs = [];

async function requireLib(libPath) {
	if (!loadedLibs.includes(libPath)) {
		loadedLibs.push(libPath);

		await browser.runtime.sendMessage({name: 'load-script', file: libPath});
	}
}
