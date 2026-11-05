# tracking

this is a web application for testing computer vision techniques on the web

## Positions

Mice react to where they are placed. See `position.html` for diagrams.

- **Adjacency**: two mice less than 2 code-widths apart are linked. If they share 3 or more tags, they are a bonded pair.
- **Alignment**: three or more mice in a line form an adoption line, numbered from the end nearest the Adoption desk.
- **Zones**: a mouse in the Nest naps. A mouse that stays at the Adoption desk for 2 seconds is ready to adopt.
- **Cat** (QR text `cat`) warns mice within 3 widths. **Cheese** (QR text `cheese`) feeds mice next to it.

Press **Simulate** on the scanner to drag virtual codes around without a camera.

## House and Workshop (floor plan)

Both tabs use the floor plan and QR codes from [Spatial Pixel Test](https://github.com/makersophie/Spatial-Pixel-Test).
Print `print/map.pdf` and `print/cards.pdf` at 100%. The map has a QR anchor in each corner (`map-tl`, `map-tr`,
`map-br`, `map-bl`); once the camera sees all four, every card is placed on the plan, so the rooms (kitchen,
mouse hole, living room, hallway) stay put even if the camera moves. Press **Simulate** to drag virtual cards instead.

- **House** is the Spatial Pixel Test game: MS-01 (`bottle-empty`), MS-02 (`bottle-half`) and HM-01 (`bottle-full`)
  react to their room, a mouse that meets the human is caught (GAME OVER), and two mice together are happy.
- **Workshop** is the Position workshop on the same map, with the mice, the human, three need cards
  (`object-a` water, `object-c` light, `object-b` medicine) and three resource cards (`bottle`, `phone`, `notebook`):
  - Part 1: *inside* a room, *next to* (< 1.8 card-widths), *in a row* (3+ on a line) and in a *group* (3+ linked).
  - Part 2a: groups get circled, rows get numbered, and two mice in one room take it over.
  - Part 2b: a resource delivers to the matching need next to it, and the human warns mice within 2.5 widths.
