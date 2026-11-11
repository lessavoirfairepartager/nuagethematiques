# Nuage de thématiques

Outil d'animation : les participants écrivent des phrases et les rangent dans des thématiques ;
le nuage affiche les thématiques ; on tire des besoins du thème retenu, on vote, on formule l'objectif.

## Mise en ligne (Netlify)

Le glisser-déposer ne suffit pas : il y a une fonction serveur à construire.

1. Créer un dépôt GitHub avec le contenu de ce dossier (sans `node_modules`).
2. Sur Netlify : « Add new project » > « Import an existing project » > choisir le dépôt.
   Rien à régler : `netlify.toml` indique le dossier publié (`public`) et celui des fonctions.
3. Ouvrir l'adresse du site, déplier « Créer une séance », valider.

Variante sans GitHub : `npm install`, puis `npx netlify-cli deploy --prod` depuis ce dossier.

Option : pour réserver la création de séances, ajouter dans Netlify la variable d'environnement
`CREATE_PASSWORD` (Project configuration > Environment variables), puis redéployer.

## Utilisation

- Créer la séance : on arrive sur le lien animateur (`?s=CODE&k=CLÉ`). Le garder en favori :
  il n'y a pas d'autre moyen de retrouver les droits d'animation.
- Donner aux participants le lien `?s=CODE`, ou coller dans Magistère le code iframe affiché
  dans l'espace animateur (éditeur HTML d'une Page ou d'une Étiquette).
- L'animateur fait avancer les 4 étapes en cliquant dessus : Collecte, Besoins, Sondage, Objectif.
- « Projection » affiche le nuage en plein écran ; « Exports » donne synthèse texte, CSV et JSON.
- Supprimer la séance à la fin efface tout du serveur.

## Données

Aucun nom, aucun compte. Chaque appareil reçoit un identifiant aléatoire (pour retrouver ses
phrases et ne voter qu'une fois), jamais affiché ni exporté. Une séance = un fichier JSON dans
Netlify Blobs.

## Tests locaux

`npm install`, puis `npm test` (API) ou `npm run local` (site sur http://localhost:8899,
données en mémoire).
