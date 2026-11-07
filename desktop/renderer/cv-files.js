import '../i18n/screens-helpers.js';
import {t} from '../i18n/index.js';
// The CV file kinds the setup card and the CV picker accept: one copy, read by the window and by the main-side picker (lib/setup-handlers.js chooseCv).
export const CV_FILES = {label: t('helperTail.pdfWord'), extensions: ['pdf', 'docx']};   // Word: kept as cv.docx, drawn to cv.pdf (lib/cv-docx.js)
