export { default as compile } from './compile/index';
export { default as parse } from './parse/index';
export { default as preprocess } from './preprocess/index';
export { walk } from 'estree-walker';

import Stats from './Stats';
import Component from './compile/Component';
import ssr from './compile/render_ssr/index';
import get_name_from_filename from './compile/utils/get_name_from_filename';

export {
	Stats,
	Component,
	ssr,
	get_name_from_filename
};

export { validate_options } from './compile/index';
export * from './compile/utils/stringify';
export { collapse_template_literal } from './compile/utils/collapse_template_literal';

export * as code_red from 'code-red';

export const VERSION = '__VERSION__';
// additional exports added through generate-type-definitions.js
