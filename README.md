# tracking

this is a web application for testing computer vision techniques on the web

## Positions

Mice react to where they are placed. See `position.html` for diagrams.

- **Adjacency**: two mice less than 2 code-widths apart are linked. If they share 3 or more tags, they are a bonded pair.
- **Alignment**: three or more mice in a line form an adoption line, numbered from the end nearest the Adoption desk.
- **Zones**: a mouse in the Nest naps. A mouse that stays at the Adoption desk for 2 seconds is ready to adopt.
- **Cat** (QR text `cat`) warns mice within 3 widths. **Cheese** (QR text `cheese`) feeds mice next to it.

Press **Simulate** on the scanner to drag virtual codes around without a camera.
