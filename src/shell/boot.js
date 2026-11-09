/* Boot: runs last, after every module has registered its views, seeders and tickers. */
seed();
applyTheme();
render();
setInterval(tick, 1000);
lightUp();
