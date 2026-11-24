import type { Language } from '../shared/types'

// Text from the main process that people see: file dialog filters, default
// names of new items, and error messages shown in the control window. In
// English and in Spanish, like src/renderer/src/strings.ts (the text of the windows).

const en = {
  // File dialogs
  filterAllFiles: 'All files',
  filterMedia: 'Video and images',
  filterImages: 'Images',
  filterOrder: 'Video, images and slides',
  filterMusic: 'Music',
  filterBible: 'Bible files',

  // Default names
  groupMain: 'Main',
  groupStage: 'Stage',
  groupNumbered: (n: number) => `Group ${n}`,
  newCountdown: 'Countdown',
  newText: 'New text',
  favoriteLogo: 'Logo',
  favoriteCountdown: 'Countdown 5 min',
  favoriteBlack: 'Black screen',

  // Errors
  serverAnswered: (status: number) => `The server answered ${status}`,
  unknownVersion: 'Unknown version',
  notInCatalog: 'This version is not in the catalog',
  unknownJson: 'Unknown JSON format',
  noVersesFound: 'No verses found. Use Zefania XML, OSIS XML, JSON or a text file with book, chapter, verse, text.',
  keysNotAllowed: 'Windows did not allow listening to keys in the background.',
  noKeyDevice: 'Windows did not tell which device the keys came from.',
  noMessageWindow: 'Windows did not make the message window.',
  noKeyboardHook: 'Windows did not allow the keyboard hook.',
  pdfWindowClosed: 'The PDF window closed',
  noPdfMade: 'no PDF was made',
  powerPointFailed: (detail: string) => `PowerPoint could not convert the file: ${detail}`,
  conversionFailed: (detail: string) => `Conversion failed: ${detail}`,
  hymnMissing: (number: number, old: boolean) => `Hymn ${number}${old ? ' (A)' : ''} is not in the hymnal folder.`,
  ytDownloaderFailed: (status: number) => `Could not download the YouTube downloader (${status}). Check the internet connection.`,
  ytStopped: 'Stopped.',
  ytFailed: (code: number | null) => `The download did not work (code ${code}).`,
  ytNotVideoLink: 'This is not a link to a video.',
  ytUnavailable: 'This video is not available (private or removed).',
  ytAgeLimit: 'YouTube asks to sign in for this video (age limit). It cannot be downloaded.',
  ytNoInternet: 'No internet connection, or YouTube did not answer.',
  ytLiveStream: 'This is a live stream. Only videos that ended can be downloaded.',
  ytFileMissing: 'The download ended, but the file was not found.',
  notZip: 'Not a zip file'
}

const es: typeof en = {
  // File dialogs
  filterAllFiles: 'Todos los archivos',
  filterMedia: 'Videos e imágenes',
  filterImages: 'Imágenes',
  filterOrder: 'Videos, imágenes y diapositivas',
  filterMusic: 'Música',
  filterBible: 'Archivos de Biblia',

  // Default names
  groupMain: 'Principal',
  groupStage: 'Plataforma',
  groupNumbered: (n: number) => `Grupo ${n}`,
  newCountdown: 'Cuenta regresiva',
  newText: 'Texto nuevo',
  favoriteLogo: 'Logo',
  favoriteCountdown: 'Cuenta regresiva 5 min',
  favoriteBlack: 'Pantalla negra',

  // Errors
  serverAnswered: (status: number) => `El servidor respondió ${status}`,
  unknownVersion: 'Versión desconocida',
  notInCatalog: 'Esta versión no está en el catálogo',
  unknownJson: 'Formato JSON desconocido',
  noVersesFound:
    'No se encontraron versículos. Usa Zefania XML, OSIS XML, JSON o un archivo de texto con libro, capítulo, versículo y texto.',
  keysNotAllowed: 'Windows no permitió escuchar las teclas en segundo plano.',
  noKeyDevice: 'Windows no indicó de qué dispositivo venían las teclas.',
  noMessageWindow: 'Windows no creó la ventana de mensajes.',
  noKeyboardHook: 'Windows no permitió el gancho de teclado.',
  pdfWindowClosed: 'Se cerró la ventana de PDF',
  noPdfMade: 'no se creó ningún PDF',
  powerPointFailed: (detail: string) => `PowerPoint no pudo convertir el archivo: ${detail}`,
  conversionFailed: (detail: string) => `Falló la conversión: ${detail}`,
  hymnMissing: (number: number, old: boolean) => `El himno ${number}${old ? ' (A)' : ''} no está en la carpeta del himnario.`,
  ytDownloaderFailed: (status: number) => `No se pudo descargar el descargador de YouTube (${status}). Revisa la conexión a internet.`,
  ytStopped: 'Detenido.',
  ytFailed: (code: number | null) => `La descarga no funcionó (código ${code}).`,
  ytNotVideoLink: 'Este no es un enlace a un video.',
  ytUnavailable: 'Este video no está disponible (privado o eliminado).',
  ytAgeLimit: 'YouTube pide iniciar sesión para este video (límite de edad). No se puede descargar.',
  ytNoInternet: 'No hay conexión a internet, o YouTube no respondió.',
  ytLiveStream: 'Es una transmisión en directo. Solo se pueden descargar videos que ya terminaron.',
  ytFileMissing: 'La descarga terminó, pero no se encontró el archivo.',
  notZip: 'No es un archivo zip'
}

/** The text of the chosen language. setMainLanguage() changes this object in place. */
export const mainStrings: typeof en = { ...es }

export function setMainLanguage(language: Language): void {
  Object.assign(mainStrings, language === 'en' ? en : es)
}
