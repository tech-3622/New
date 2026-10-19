(function () {
  const grid = document.getElementById('bal-tck').closest('.grid');
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4';

  const card = document.createElement('div');
  card.className = 'glass-panel p-5 sm:p-6 rounded-3xl border border-blue-500/30 relative overflow-hidden flex flex-col justify-between';
  card.innerHTML =
    '<div>' +
    '<div class="flex justify-between items-center text-xs text-gray-400 font-medium mb-1">' +
    '<span>Naira Balance</span>' +
    '<span class="text-blue-400 bg-blue-500/20 px-2 py-0.5 rounded-full text-[10px] font-bold">NGN</span>' +
    '</div>' +
    '<div class="text-2xl sm:text-3xl font-black text-white mt-1">₦<span id="bal-naira">0.00</span></div>' +
    '<div class="text-xs text-gray-400 font-semibold mt-2">Use it to buy TCK or withdraw</div>' +
    '</div>' +
    '<div class="grid grid-cols-2 gap-2 mt-4">' +
    '<button onclick="openActionModal(\'deposit\')" class="bg-blue-500/20 hover:bg-blue-500/30 text-blue-400 border border-blue-500/40 font-bold py-2 rounded-xl text-xs transition-all">Add Money</button>' +
    '<button onclick="switchTab(\'swap\'); switchSwapMode(\'buy\')" class="bg-naija-500/20 hover:bg-naija-500/30 text-naija-500 border border-naija-500/40 font-bold py-2 rounded-xl text-xs transition-all">Buy TCK</button>' +
    '</div>';
  grid.insertBefore(card, grid.firstChild);

  const origPaint = window.paint;
  window.paint = function () {
    origPaint();
    document.getElementById('bal-naira').innerText = fmt(userNGN);
  };

  const origRender = window.renderTransactions;
  window.renderTransactions = function () {
    ACT = ACT.filter(function (a) { return a.title !== 'Deposit Pending'; });
    origRender();
  };
})();
