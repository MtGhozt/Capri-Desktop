'use strict';

// The tray menu (and the one she opens when you right-click her), in every language she speaks.
// The order of this object is the order of the Language submenu.

const TRAY = {
  fr: {
    name: 'Français',
    online: (port) => `Capri — à l'écoute sur ${port}`,
    closeMenu: 'Fermer le menu', teleport: 'Téléporter', satellite: 'Regarder le satellite', demo: 'Lancer la démo', help: 'Comment ça marche ?',
    show: 'La faire revenir', hide: 'La ranger', sleep: 'Dormir', wake: 'Réveiller',
    size: 'Taille', small: 'Petite', medium: 'Moyenne', large: 'Grande', sound: 'Son', mute: 'Muet',
    reply: 'Réponse', replyVoice: 'Voix', replyBlips: 'Blips', replySilent: 'Silence',
    soundsDir: 'Ouvrir le dossier des sons perso', screen: 'Écran', wander: 'Se balader quand rien ne se passe',
    possess: 'Posséder mes fenêtres', lang: 'Langue', auto: 'Automatique (système)', startup: 'Lancer au démarrage',
    micOn: 'Microphone : on', micOff: 'Microphone : off', micDevice: 'Entrée micro', micDefault: 'Par défaut',
    hooksOn: 'Hooks Claude Code : installés', hooksOff: 'Installer les hooks Claude Code',
    hooksRemove: 'Retirer les hooks Claude Code', quit: 'Quitter',
  },
  en: {
    name: 'English',
    online: (port) => `Capri — listening on ${port}`,
    closeMenu: 'Close the menu', teleport: 'Teleport', satellite: 'Look at the satellite', demo: 'Play demo', help: 'How does it work?',
    show: 'Bring her back', hide: 'Put her away', sleep: 'Sleep', wake: 'Wake up',
    size: 'Size', small: 'Small', medium: 'Medium', large: 'Large', sound: 'Sound', mute: 'Mute',
    reply: 'Reply', replyVoice: 'Voice', replyBlips: 'Blips', replySilent: 'Silent',
    soundsDir: 'Open custom sounds folder', screen: 'Screen', wander: 'Wander around when idle',
    possess: 'Possess my windows', lang: 'Language', auto: 'Automatic (system)', startup: 'Start with Windows',
    micOn: 'Microphone: on', micOff: 'Microphone: off', micDevice: 'Input device', micDefault: 'Default',
    hooksOn: 'Claude Code hooks: installed', hooksOff: 'Install Claude Code hooks',
    hooksRemove: 'Remove Claude Code hooks', quit: 'Quit',
  },
  es: {
    name: 'Español',
    online: (port) => `Capri — escuchando en ${port}`,
    closeMenu: 'Cerrar menú', teleport: 'Teletransportar', satellite: 'Mirar el satélite', demo: 'Ver la demo', help: '¿Cómo funciona?',
    show: 'Traerla de vuelta', hide: 'Guardarla', sleep: 'Dormir', wake: 'Despertar',
    size: 'Tamaño', small: 'Pequeña', medium: 'Mediana', large: 'Grande', sound: 'Sonido', mute: 'Silenciar',
    reply: 'Respuesta', replyVoice: 'Voz', replyBlips: 'Blips', replySilent: 'Silencio',
    soundsDir: 'Abrir la carpeta de sonidos propios', screen: 'Pantalla', wander: 'Pasear cuando no pasa nada',
    possess: 'Poseer mis ventanas', lang: 'Idioma', auto: 'Automático (sistema)', startup: 'Iniciar con Windows',
    micOn: 'Micrófono: on', micOff: 'Micrófono: off', micDevice: 'Entrada', micDefault: 'Predeterminado',
    hooksOn: 'Hooks de Claude Code: instalados', hooksOff: 'Instalar los hooks de Claude Code',
    hooksRemove: 'Quitar los hooks de Claude Code', quit: 'Salir',
  },
  pt: {
    name: 'Português (Brasil)',
    online: (port) => `Capri — ouvindo na porta ${port}`,
    closeMenu: 'Fechar o menu', teleport: 'Teletransportar', satellite: 'Olhar o satélite', demo: 'Ver a demo', help: 'Como funciona?',
    show: 'Trazer de volta', hide: 'Guardar', sleep: 'Dormir', wake: 'Acordar',
    size: 'Tamanho', small: 'Pequena', medium: 'Média', large: 'Grande', sound: 'Som', mute: 'Sem som',
    reply: 'Resposta', replyVoice: 'Voz', replyBlips: 'Blips', replySilent: 'Silêncio',
    soundsDir: 'Abrir a pasta de sons personalizados', screen: 'Tela', wander: 'Passear quando nada acontece',
    possess: 'Possuir minhas janelas', lang: 'Idioma', auto: 'Automático (sistema)', startup: 'Iniciar com o Windows',
    micOn: 'Microfone: on', micOff: 'Microfone: off', micDevice: 'Entrada', micDefault: 'Padrão',
    hooksOn: 'Hooks do Claude Code: instalados', hooksOff: 'Instalar os hooks do Claude Code',
    hooksRemove: 'Remover os hooks do Claude Code', quit: 'Sair',
  },
  ru: {
    name: 'Русский',
    online: (port) => `Capri — слушаю порт ${port}`,
    closeMenu: 'Закрыть меню', teleport: 'Телепортироваться', satellite: 'Посмотреть на спутник', demo: 'Запустить демо', help: 'Как это работает?',
    show: 'Вернуть её', hide: 'Спрятать', sleep: 'Спать', wake: 'Разбудить',
    size: 'Размер', small: 'Маленькая', medium: 'Средняя', large: 'Большая', sound: 'Звук', mute: 'Без звука',
    reply: 'Ответ', replyVoice: 'Голос', replyBlips: 'Blips', replySilent: 'Тишина',
    soundsDir: 'Открыть папку своих звуков', screen: 'Экран', wander: 'Гулять, когда ничего не происходит',
    possess: 'Вселяться в мои окна', lang: 'Язык', auto: 'Автоматически (системный)', startup: 'Запускать вместе с Windows',
    micOn: 'Микрофон: вкл.', micOff: 'Микрофон: выкл.', micDevice: 'Вход', micDefault: 'По умолчанию',
    hooksOn: 'Хуки Claude Code: установлены', hooksOff: 'Установить хуки Claude Code',
    hooksRemove: 'Удалить хуки Claude Code', quit: 'Выйти',
  },
};

module.exports = { TRAY, LANGS: Object.keys(TRAY) };
