import configUtils from '../../lib/configUtils';

import Actions from '../core/Actions';
import Component from '../core/Component';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import React from 'react';

import CardAddress from '../component/Card/CardAddress';
import CardAddressTXs from '../component/Card/CardAddressTXs';
import HorizontalRule from '../component/HorizontalRule';
import Pagination from '../component/Pagination';
import Select from '../component/Select';
import MasternodesList from '../component/MasternodesList';

import { PAGINATION_PAGE_SIZE } from '../constants';

class Address extends Component {
  static propTypes = {
    getAddress: PropTypes.func.isRequired,
    match: PropTypes.object.isRequired
  };

  constructor(props) {
    super(props);
    this.state = {
      address: '',
      balance: 0.0,
      received: 0.0,
      error: null,
      loading: true,
      pages: 0,
      page: 1,
      size: 10,
      txs: [],
      utxo: [],
      isMasternode: false
    };
  };

  componentDidMount() {
    this.getAddress();
  };

  componentDidUpdate() {
    if (!!this.state.address
      && this.state.address !== this.props.match.params.hash && !this.state.loading) {
      this.getAddress();
    }
  };

  getAddress = () => {
    this.setState({ loading: true }, () => {
      const address = this.props.match.params.hash;
      this.props.getAddress({ address }).then(({ balance, received, txs, utxo, isMasternode }) => {
        this.setState({
          address,
          balance,
          received,
          txs,
          utxo,
          loading: false,
          pages: Math.ceil(txs.length / this.state.size),
          isMasternode
        });
      })
      .catch(error => this.setState({ error, loading: false }));
    });
  };

  handlePage = page => this.setState({ page: parseInt(page, 10) });
  handleSize = size => this.setState({ size: parseInt(size, 10), page: 1 }, () => {
    this.setState({ pages: Math.ceil(this.state.txs.length / this.state.size) });
  });

  getMasternodeDetails = () => {
    if (!this.state.isMasternode) {
      return null;
    }
    return (
      <MasternodesList title="Masternode For Address" isPaginationEnabled={false} getMNs={this.props.getMNs} hideCols={["addr"]} />
    );
  }

  getMasternodesAddressWidget = () => {
    const address = this.props.match.params.hash;
    const masternodesAddressWidget = configUtils.getCommunityAddressWidgetConfig(address, "masternodesAddressWidget");
    if (!masternodesAddressWidget) {
      return null;
    }

    return (
      <MasternodesList title={masternodesAddressWidget.title} isPaginationEnabled={masternodesAddressWidget.isPaginationEnabled} getMNs={this.props.getMasternodesAddressWidget} />
    );
  }

  render() {
    if (!!this.state.error) {
      return this.renderError(this.state.error);
    } else if (this.state.loading) {
      return this.renderLoading();
    }
    const selectOptions = PAGINATION_PAGE_SIZE;

    const select = (
      <Select
        onChange={value => this.handleSize(value)}
        selectedValue={this.state.size}
        options={selectOptions} />
    );

    /**
     * Setup internal pagination.
     */
    let start = (this.state.page - 1) * this.state.size;
    let end = start + this.state.size;

    return (
      <div>
        <HorizontalRule title="Wallet Info" />
        <CardAddress
          address={this.state.address}
          balance={this.state.balance}
          received={this.state.received}
          txs={this.state.txs}
          utxo={this.state.utxo} />
        <HorizontalRule select={select} title="Wallet Transactions" />
        <CardAddressTXs
          address={this.state.address}
          txs={this.state.txs.slice(start, end)}
          utxo={this.state.utxo} />
        <Pagination
          current={this.state.page}
          className="float-right"
          onPage={this.handlePage}
          total={this.state.pages} />
        <div className="clearfix" />
        {this.getMasternodeDetails()}
        {this.getMasternodesAddressWidget()}
      </div>
    );
  };
}

const mapDispatch = (dispatch, ownProps) => ({
  getAddress: query => Actions.getAddress(query),
  getMNs: query => {
    query.hash = ownProps.match.params.hash; /* Add current wallet address to the filtering of getMNs(). Look at server/handler/blockex.js getMasternodes() */
    return Actions.getMNs(query);
  },
  getMasternodesAddressWidget: query => {
    const address = ownProps.match.params.hash;
    const masternodesAddressWidget = configUtils.getCommunityAddressWidgetConfig(address, "masternodesAddressWidget");
    if (!masternodesAddressWidget) {
      return null;
    }
    query.addresses = masternodesAddressWidget.addresses; /* Add array of wallet addresses to the filtering of getMNs(). Look at server/handler/blockex.js getMasternodes() */
    return Actions.getMNs(query);
  }
});

const mapState = state => ({
});

export default connect(mapState, mapDispatch)(Address);
