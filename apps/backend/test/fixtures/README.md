Os arquivos `build.7z`, `build.tar.bz2` e `build.tar.xz` são fixtures sem senha, geradas com bsdtar a partir de um TAR produzido pelo helper `../archive-fixture.cjs`.

Todos contêm estes arquivos de texto, sem dados externos:

- `release/ecosystem.config.js`: `module.exports={apps:[]};`
- `release/main.js`: `console.log("compactado");`

São usados para verificar extração e download dos formatos binários sem instalar ferramentas de compactação no ambiente dos testes.
