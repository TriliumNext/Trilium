import cancelIcon from '@ckeditor/ckeditor5-core/theme/icons/cancel.svg?raw';
import { ButtonView, Locale, toUnit, View } from 'ckeditor5';

const toPx = toUnit('%');

export default class ProgressBarView extends View {
    private cancelButton: ButtonView;
    width!: number;
    customWidth!: number;

	constructor(locale: Locale) {
		super(locale);

		const bind = this.bindTemplate;
		this.cancelButton = this._createCancelButton(locale);

		// Views define their interface (state) using observable attributes.
		this.set('width', 100);
		this.set('customWidth', 0);


		this.setTemplate({
			tag: 'div',

			// The element of the view can be defined with its children.
			children: [
				{
					tag: 'div',
					children: ['Uploading...'],
					attributes: {
						class: ['ck-uploading-progress'],
						style: {
							width: bind.to('customWidth', toPx),
						}
					}
				},
				this.cancelButton,
			],
			attributes: {
				class: [
					'ck-progress-bar',

					// Observable attributes control the state of the view in DOM.
                    //@ts-expect-error Type 'ListenerBinding' is not assignable to type 'TemplateSimpleValueSchema'
					bind.to('elementClass')
				],
				style: {
					width: bind.to('width', toPx),
				}
			}
		});
	}

	_createCancelButton(locale: Locale) {
		const view = new ButtonView(locale);
		view.set({
			icon: cancelIcon,
			tooltip: true,
			label: 'Cancel',
            //@ts-expect-error Object literal may only specify known properties, and 'attributes' does not exist in type
			attributes: {
				class: ['ck', 'ck-button', 'ck-off', 'ck-button-cancel', 'ck-uploading-cancel']
			}
		});

		view.on('execute', () => {
			this.fire('cancel')
		});
		return view;
	}
}
