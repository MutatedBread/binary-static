const moment               = require('moment');
const StatementUI          = require('./statement.ui');
const Slider               = require('../../slider/slider');
const BinarySocket         = require('../../../socket');
const getLanguage          = require('../../../../base/language').get;
const localize             = require('../../../../base/localize').localize;
const showLocalTimeOnHover = require('../../../../base/clock').showLocalTimeOnHover;
const addTooltip           = require('../../../../common_functions/get_app_details').addTooltip;
const buildOauthApps       = require('../../../../common_functions/get_app_details').buildOauthApps;
const dateValueChanged     = require('../../../../common_functions/common_functions').dateValueChanged;
const jpClient             = require('../../../../common_functions/country_base').jpClient;
const toISOFormat          = require('../../../../common_functions/string_util').toISOFormat;
const DatePicker           = require('../../../../components/date_picker');
const sortingMode          = require('./sortingMode');

const StatementInit = (() => {
    'use strict';

    // Batch refer to number of data get from ws service per request
    // chunk refer to number of data populate to ui for each append
    // receive means receive from ws service
    // consume means consume by UI and displayed to page

    let batch_size,
        chunk_size,
        no_more_data,
        pending,
        current_batch,
        transactions_received,
        transactions_consumed,
        currentSortingMode = sortingMode.DATE_RECENT,
        clonedHeader = null;

    const tableExist = () => (document.getElementById('statement-table'));

    const finishedConsumed = () => (transactions_consumed === transactions_received);

    const getStatement = (opts) => {
        const req = { statement: 1, description: 1 };

        if (opts) $.extend(true, req, opts);

        const jump_to_val = $('#jump-to').attr('data-value');
        if (jump_to_val && jump_to_val !== '') {
            req.date_to = moment.utc(jump_to_val).unix() + ((jpClient() ? 15 : 24) * (60 * 60));
            req.date_from = 0;
        }
        BinarySocket.send(req).then((response) => {
            statementHandler(response);
        });
    };

    const getNextBatchStatement = () => {
        getStatement({ offset: transactions_received, limit: batch_size });
        pending = true;
    };

    const getNextChunkStatement = () => {
        const chunk = current_batch.splice(0, chunk_size);
        transactions_consumed += chunk.length;
        $('#rows_count').text(transactions_consumed);
        return chunk;
    };

    const statementHandler = (response) => {
        if (response.error) {
            StatementUI.errorMessage(response.error.message);
            return;
        }

        pending = false;

        const statement = response.statement;
        current_batch = statement.transactions;
        transactions_received += current_batch.length;

        if (current_batch.length < batch_size) {
            no_more_data = true;
        }

        if (!tableExist()) {
            const $header = StatementUI.createEmptyStatementTable();
            headerSorterBinder($header);
            headerPointerCursorAndIcon($header);
            $header.appendTo('#statement-container');
            $('.act, .credit').addClass('nowrap');
            StatementUI.updateStatementTable(getNextChunkStatement());

            // Show a message when the table is empty
            if (transactions_received === 0 && current_batch.length === 0) {
                $('#statement-table').find('tbody')
                    .append($('<tr/>', { class: 'flex-tr' })
                        .append($('<td/>', { colspan: 7 })
                            .append($('<p/>', { class: 'notice-msg center-text', text: localize('Your account has no trading activity.') }))));
            } else {
                $('#util_row').setVisibility(1);
                if (getLanguage() === 'JA') {
                    $('#download_csv').setVisibility(1)
                                      .find('a')
                                      .unbind('click')
                                      .click(() => { StatementUI.exportCSV(); });
                }
            }
        }
        showLocalTimeOnHover('td.date');
    };

    const loadStatementChunkWhenScroll = () => {
        $(document).scroll(() => {
            if ($(document).scrollTop() >= getTableBody().children('tr').first().offset().top &&
                $(document).scrollTop() <= getTableBody().children('tr').last().offset().top &&
                !clonedHeader) {
                // clone header and clone statement table and append
                clonedHeader = $('#statement-table').find('thead').clone();
                clonedHeader.addClass('sticky');
                const stickyHeaderContainer = $('<table>', { id: 'statement-table', class: 'sticky-table' });
                stickyHeaderContainer.append(clonedHeader);
                $('.table-container').append(stickyHeaderContainer);

                // add class sticky
                clonedHeader.addClass('sticky');

                // resize the cloned header
                const children = $('.sticky').find('tr').children('th');
                const reference = getTableBody().children('tr').first().children('td');
                for (let i = 0; i < children.length; i++) {
                    children.eq(i).width(reference.eq(i).width());
                }

                // bind cloned header with click listener to sorting functions
                headerSorterBinder($('.sticky'));
            } else if ($(document).scrollTop() < getTableBody().children('tr').first().offset().top ||
                        $(document).scrollTop() > getTableBody().children('tr').last().offset().top) {
                // if header is visible or table finishes, destroy cloned header with table
                if (clonedHeader) {
                    $('.sticky-table').remove();
                    clonedHeader = null;
                }
            }

            const hidableHeight = (percentage) => {
                const total_hideable = $(document).height() - $(window).height();
                return Math.floor((total_hideable * percentage) / 100);
            };

            const p_from_top = $(document).scrollTop();

            if (!tableExist() || p_from_top < hidableHeight(70)) return;

            if (finishedConsumed() && !no_more_data && !pending) {
                getNextBatchStatement();
                return;
            }

            if (!finishedConsumed()) {
                StatementUI.updateStatementTable(getNextChunkStatement());
                switch (currentSortingMode) {
                    case sortingMode.DATE_LONGTIMEAGO:
                    case sortingMode.DATE_RECENT:
                        orderTableByDate(false);
                        break;
                    case sortingMode.REF_LEAST:
                    case sortingMode.REF_MOST:
                        orderTableByRef(false);
                        break;
                    case sortingMode.PAYOUT_LEAST:
                    case sortingMode.PAYOUT_MOST:
                        orderTableByPayout(false);
                        break;
                    case sortingMode.ACT_BUY:
                    case sortingMode.ACT_SELL:
                        orderTableByAction(false);
                        break;
                    case sortingMode.CREDIT_LOSSES:
                    case sortingMode.CREDIT_PROFIT:
                        orderTableByCredit(false);
                        break;
                    case sortingMode.BAL_LEAST:
                    case sortingMode.BAL_MOST:
                        orderTableByBalance(false);
                        break;
                    default:
                        break;
                }
            }
        });
    };

    const onUnload = () => {
        pending = false;
        no_more_data = false;

        current_batch = [];

        transactions_received = 0;
        transactions_consumed = 0;

        StatementUI.errorMessage(null);
        StatementUI.clearTableContent();
    };

    const initPage = () => {
        batch_size = 200;
        chunk_size = batch_size / 2;
        no_more_data = false;
        pending = false;            // serve as a lock to prevent ws request is sequential
        current_batch = [];
        transactions_received = 0;
        transactions_consumed = 0;

        BinarySocket.send({ oauth_apps: 1 }).then((response) => {
            addTooltip(StatementUI.setOauthApps(buildOauthApps(response)));
            $('.barspinner').setVisibility(0);
        });
        getNextBatchStatement();
        loadStatementChunkWhenScroll();
    };

    const attachDatePicker = () => {
        const jump_to = '#jump-to';
        $(jump_to).attr('data-value', toISOFormat(moment()))
             .change(function() {
                 if (!dateValueChanged(this, 'date')) {
                     return false;
                 }
                 $('.table-container').remove();
                 StatementUI.clearTableContent();
                 initPage();
                 return true;
             });
        DatePicker.init({
            selector: jump_to,
            maxDate : 0,
        });
        if ($(jump_to).attr('data-picker') !== 'native') $(jump_to).val(localize('Today'));
    };

    const onLoad = () => {
        initPage();
        attachDatePicker();
        Slider.viewButtonOnClick('#statement-container');
    };

    const headerSorterBinder = (header) => {
        header.find('.date').on('click', () => {
            orderTableByDate(true);
        });
        header.find('.ref').on('click', () => {
            orderTableByRef(true);
        });
        header.find('.payout').on('click', () => {
            orderTableByPayout(true);
        });
        header.find('.act').on('click', () => {
            orderTableByAction(true);
        });
        header.find('.credit').on('click', () => {
            orderTableByCredit(true);
        });
        header.find('.bal').on('click', () => {
            orderTableByBalance(true);
        });
    };

    const headerPointerCursorAndIcon = (header) => {
        header.find('.date').addClass('pointerCursor');
        header.find('.ref').addClass('pointerCursor');
        header.find('.payout').addClass('pointerCursor');
        header.find('.act').addClass('pointerCursor');
        header.find('.credit').addClass('pointerCursor');
        header.find('.bal').addClass('pointerCursor');

        header.find('.date').append('<span class="sortIcon"></span>');
        header.find('.ref').append('<span class="sortIcon"></span>');
        header.find('.payout').append('<span class="sortIcon"></span>');
        header.find('.act').append('<span class="sortIcon"></span>');
        header.find('.credit').append('<span class="sortIcon"></span>');
        header.find('.bal').append('<span class="sortIcon"></span>');
    };

    const orderTableByDate = (change) => {
        if (change) {
            if (currentSortingMode === sortingMode.DATE_LONGTIMEAGO) {
                currentSortingMode = sortingMode.DATE_RECENT;
            } else {
                currentSortingMode = sortingMode.DATE_LONGTIMEAGO;
            }
        }
        const children = getTableBody().children('tr');
        const rowsInfo = [];
        for (let i = 0; i < children.length; i++) {
            rowsInfo.push(getRowInfoFromTR(children.eq(i)));
        }
        const descending = ((Number(currentSortingMode !== sortingMode.DATE_LONGTIMEAGO) * 2) - 1);
        const ascending = ((Number(currentSortingMode === sortingMode.DATE_LONGTIMEAGO) * 2) - 1);

        rowsInfo.sort((a, b) => {
            const dateFirst = a.date.replace(/[-:GMT \n]/g, '');
            const dateSecond = b.date.replace(/[-:GMT \n]/g, '');
            if (dateFirst < dateSecond) {
                return descending;
            }
            if (dateFirst > dateSecond) {
                return ascending;
            }
            return 0;
        });
        replaceTableBodyRowsInfo(children, rowsInfo);
    };

    const orderTableByRef = (change) => {
        if (change) {
            if (currentSortingMode === sortingMode.REF_LEAST) {
                currentSortingMode = sortingMode.REF_MOST;
            } else {
                currentSortingMode = sortingMode.REF_LEAST;
            }
        }
        const children = getTableBody().children('tr');
        const rowsInfo = [];
        for (let i = 0; i < children.length; i++) {
            rowsInfo.push(getRowInfoFromTR(children.eq(i)));
        }
        const descending = ((Number(currentSortingMode !== sortingMode.REF_LEAST) * 2) - 1);
        const ascending = ((Number(currentSortingMode === sortingMode.REF_LEAST) * 2) - 1);

        rowsInfo.sort((a, b) => {
            if (a.ref < b.ref) {
                return descending;
            }
            if (a.ref > b.ref) {
                return ascending;
            }
            return 0;
        });
        replaceTableBodyRowsInfo(children, rowsInfo);
    };

    const orderTableByPayout = (change) => {
        if (change) {
            if (currentSortingMode === sortingMode.PAYOUT_MOST) {
                currentSortingMode = sortingMode.PAYOUT_LEAST;
            } else {
                currentSortingMode = sortingMode.PAYOUT_MOST;
            }
        }
        const children = getTableBody().children('tr');
        const rowsInfo = [];
        for (let i = 0; i < children.length; i++) {
            rowsInfo.push(getRowInfoFromTR(children.eq(i)));
        }
        const descending = ((Number(currentSortingMode !== sortingMode.PAYOUT_MOST) * 2) - 1);
        const ascending = ((Number(currentSortingMode === sortingMode.PAYOUT_MOST) * 2) - 1);

        rowsInfo.sort((a, b) => {
            const aPayNum = Number(a.payout.replace(/-/g, ''));
            const bPayNum = Number(b.payout.replace(/-/g, ''));

            if (aPayNum < bPayNum) {
                return descending;
            }
            if (aPayNum > bPayNum) {
                return ascending;
            }
            return 0;
        });
        replaceTableBodyRowsInfo(children, rowsInfo);
    };

    const orderTableByAction = (change) => {
        if (change) {
            if (currentSortingMode === sortingMode.ACT_BUY) {
                currentSortingMode = sortingMode.ACT_SELL;
            } else {
                currentSortingMode = sortingMode.ACT_BUY;
            }
        }
        const children = getTableBody().children('tr');
        const rowsInfo = [];
        for (let i = 0; i < children.length; i++) {
            rowsInfo.push(getRowInfoFromTR(children.eq(i)));
        }
        const buy = ((Number(currentSortingMode === sortingMode.ACT_BUY) * 2) - 1);
        const sell = ((Number(currentSortingMode !== sortingMode.ACT_BUY) * 2) - 1);
        rowsInfo.sort((a, b) => {
            if (a.act < b.act) {
                return buy;
            }
            if (a.act > b.act) {
                return sell;
            }
            return 0;
        });
        replaceTableBodyRowsInfo(children, rowsInfo);
    };

    const orderTableByCredit = (change) => {
        if (change) {
            if (currentSortingMode === sortingMode.CREDIT_PROFIT) {
                currentSortingMode = sortingMode.CREDIT_LOSSES;
            } else {
                currentSortingMode = sortingMode.CREDIT_PROFIT;
            }
        }
        const children = getTableBody().children('tr');
        const rowsInfo = [];
        for (let i = 0; i < children.length; i++) {
            rowsInfo.push(getRowInfoFromTR(children.eq(i)));
        }
        const losses = ((Number(currentSortingMode !== sortingMode.CREDIT_PROFIT) * 2) - 1);
        const profit = ((Number(currentSortingMode === sortingMode.CREDIT_PROFIT) * 2) - 1);

        rowsInfo.sort((a, b) => {
            const aCredit = Number(a.credit.replace(/,/g, ''));
            const bCredit = Number(b.credit.replace(/,/g, ''));

            if (aCredit < bCredit) {
                return profit;
            }
            if (aCredit > bCredit) {
                return losses;
            }
            return 0;
        });
        replaceTableBodyRowsInfo(children, rowsInfo);
    };

    const orderTableByBalance = (change) => {
        if (change) {
            if (currentSortingMode === sortingMode.BAL_MOST) {
                currentSortingMode = sortingMode.BAL_LEAST;
            } else {
                currentSortingMode = sortingMode.BAL_MOST;
            }
        }
        const children = getTableBody().children('tr');
        const rowsInfo = [];
        for (let i = 0; i < children.length; i++) {
            rowsInfo.push(getRowInfoFromTR(children.eq(i)));
        }
        const ascending = ((Number(currentSortingMode !== sortingMode.BAL_MOST) * 2) - 1);
        const descending = ((Number(currentSortingMode === sortingMode.BAL_MOST) * 2) - 1);

        rowsInfo.sort((a, b) => {
            const aBalance = Number(a.bal.replace(/,/g, ''));
            const bBalance = Number(b.bal.replace(/,/g, ''));
            if (aBalance < bBalance) {
                return descending;
            }
            if (aBalance > bBalance) {
                return ascending;
            }
            return 0;
        });
        replaceTableBodyRowsInfo(children, rowsInfo);
    };

    const getTableBody = () => {
        if (tableExist) {
            return $('#statement-table').find('tbody');
        }
        return null;
    };

    const getRowInfoFromTR = (tr) => {
        const row = {
            date  : tr.find('.date').html(),
            ref   : tr.find('.ref').find('span').html(),
            payout: tr.find('.payout').html(),
            act   : tr.find('.act').html(),
            desc  : tr.find('.desc').html(),
            credit: tr.find('.credit').html(),
            bal   : tr.find('.bal').html(),
        };
        if (tr.attr('contract_id') !== undefined) {
            row.contract_id = tr.attr('contract_id');
        }

        if (tr.hasClass('selectedRow')) {
            row.selectedRow = true;
        }

        return row;
    };

    const replaceTableBodyRowsInfo = (rows, sortedInfo) => {
        for (let i = 0; i < rows.length; i++) {
            const row = rows.eq(i);
            if (sortedInfo[i].contract_id) {
                row.attr('contract_id', sortedInfo[i].contract_id);
            } else {
                row.removeAttr('contract_id');
            }

            if (sortedInfo[i].selectedRow) {
                row.addClass('selectedRow');
            } else {
                row.removeClass('selectedRow');
            }

            row.find('.date').html(sortedInfo[i].date);
            row.find('.ref').find('span').html(sortedInfo[i].ref);
            row.find('.payout').html(sortedInfo[i].payout);
            row.find('.act').html(sortedInfo[i].act);
            row.find('.desc').html(sortedInfo[i].desc);
            row.find('.credit').html(sortedInfo[i].credit);
            row.find('.bal').html(sortedInfo[i].bal);

            row.find('.credit').removeClass('loss');
            row.find('.credit').removeClass('profit');

            if (sortedInfo[i].credit.replace(/,/g, '') >= 0.00) {
                row.find('.credit').removeClass('loss');
                row.find('.credit').addClass('profit');
            } else if (sortedInfo[i].credit.replace(/,/g, '') < 0.00) {
                row.find('.credit').addClass('loss');
                row.find('.credit').removeClass('profit');
            }
        }
    };

    return {
        init            : initPage,
        statementHandler: statementHandler,
        onLoad          : onLoad,
        onUnload        : onUnload,
    };
})();

module.exports = StatementInit;
