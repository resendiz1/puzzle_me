# PuzzleMe

Rompecabezas web en HTML, CSS y JavaScript vanilla. No requiere servidor ni dependencias de JavaScript.

## Ejecutar
1. Descomprime el proyecto.
2. Abre `index.html` en un navegador moderno.
3. Sube una imagen, selecciona la cantidad de piezas y comienza.

También puedes servir la carpeta con cualquier servidor estático, por ejemplo:
`python -m http.server 8000`

## Funciones
- Interfaz en modo oscuro y claro; el tema inicial sigue la preferencia del sistema y la elección manual se recuerda en el navegador.
- Perfil local con nombre e inicial.
- Dificultades fácil, media y difícil, o selección libre.
- Tablero Canvas con piezas de forma irregular (pestañas y encajes complementarios), moldes con la forma de cada pieza, arrastre, ajuste automático y giro de 90°.
- Encaje correcto con sonido de click, animación de ajuste e iluminación breve; si falla, la pieza se queda donde se soltó.
- Control por teclado: flechas para mover, Enter para colocar, R para girar, H para pedir una pista y Esc para cerrar ventanas.
- Imágenes grandes se optimizan automáticamente antes de guardarse en el navegador.
- Temporizador con minutos, horas, días y meses (`1 mes 12d 03:04:05`; un mes equivale a 30 días), pistas, vista previa, zoom y sonidos generados con Web Audio.
- Autoguardado al colocar, girar, soltar una pieza, cambiar de pestaña o cerrar la página.
- Reanudación automática al recargar o volver a abrir: conserva piezas colocadas, posiciones, orden, zoom y tiempo.
- Almacenamiento separado para perfil/récords y partida, con migración automática desde versiones anteriores y protección del último guardado si falla la cuota.
- Récords locales por tiempo.
- Pie de página con contacto y redes de JuanPancho's.

## Datos y privacidad
El perfil, récords, avance, tema y fotografía se guardan en LocalStorage del navegador, en claves separadas. No se envía la imagen a ningún servidor. Si el almacenamiento del navegador se llena, la partida anterior se conserva y se muestra un aviso; prueba con una fotografía más pequeña o borra los datos del sitio para empezar de cero.

## Contacto
- WhatsApp: 238 150 1369, 238 127 1940, 221 195 9921
- Instagram: [@juanpanchos_tehuacan](https://www.instagram.com/juanpanchos_tehuacan/)
- Facebook: [JuanPancho's](https://www.facebook.com/profile.php?id=61577993078029)
- Sitio: [juanpancho-s](https://resendiz1.github.io/juanpancho-s/)
- Tehuacán, Puebla.

