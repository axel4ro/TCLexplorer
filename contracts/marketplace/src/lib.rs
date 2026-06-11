#![no_std]

multiversx_sc::imports!();
multiversx_sc::derive_imports!();

/// TCLexplorer NFT Marketplace
/// Allows listing and buying TCL game NFTs using the TCL-fe459d token.
///
/// Flow:
///   Seller: ESDTNFTTransfer → contract.listNFT(price_in_tcl, creator, royalties)
///   Buyer:  ESDTTransfer(TCL) → contract.buyNFT(listing_id)
///   Platform fee retained and forwarded to owner per sale; royalties paid to NFT creator.

const TCL_TOKEN_ID: &[u8] = b"TCL-fe459d";
const MAX_FEE_PERCENT: u64 = 10;
const ROYALTY_DENOMINATOR: u64 = 10_000; // basis points (e.g. 500 = 5%)

#[derive(TypeAbi, TopEncode, TopDecode, NestedEncode, NestedDecode, ManagedVecItem, Clone)]
pub struct Listing<M: ManagedTypeApi> {
    pub listing_id: u64,
    pub seller: ManagedAddress<M>,
    pub nft_token: TokenIdentifier<M>,
    pub nft_nonce: u64,
    pub price: BigUint<M>,
    pub royalty_address: ManagedAddress<M>,
    pub royalty_percent: u64, // basis points, 500 = 5%
    pub timestamp: u64,
    pub is_active: bool,
}

#[multiversx_sc::contract]
pub trait TclMarketplace {
    // ─── Init ────────────────────────────────────────────────────────────────

    #[init]
    fn init(&self, fee_percent: u64) {
        require!(fee_percent <= MAX_FEE_PERCENT, "Fee too high (max 10%)");
        self.fee_percent().set(fee_percent);
        self.last_listing_id().set(0u64);
        self.paused().set(false);
    }

    #[upgrade]
    fn upgrade(&self) {}

    // ─── List NFT ────────────────────────────────────────────────────────────

    /// Seller calls this after sending the NFT via ESDTNFTTransfer.
    /// price: amount of TCL (in smallest unit, 18 decimals)
    /// royalty_address and royalty_percent must match the NFT metadata.
    /// royalty_percent uses basis points (e.g. 500 = 5%).
    #[payable("*")]
    #[endpoint(listNFT)]
    fn list_nft(
        &self,
        price: BigUint,
        royalty_address: ManagedAddress,
        royalty_percent: u64,
    ) {
        require!(!self.paused().get(), "Marketplace is paused");

        let caller = self.blockchain().get_caller();
        let payment = self.call_value().single_esdt();

        require!(payment.token_nonce > 0, "Must send an NFT (nonce > 0)");
        require!(payment.amount == BigUint::from(1u32), "Only one NFT per listing");
        require!(price > BigUint::zero(), "Price must be greater than 0");
        require!(royalty_percent <= 2_000u64, "Royalties cannot exceed 20%");

        let sc_address = self.blockchain().get_sc_address();
        let nft_data = self.blockchain().get_esdt_token_data(
            &sc_address,
            &payment.token_identifier,
            payment.token_nonce,
        );

        // Only NFTs minted by an allowed creator can be listed
        require!(
            self.allowed_creators().contains(&nft_data.creator),
            "NFT creator not authorized on this marketplace"
        );
        require!(
            royalty_address == nft_data.creator,
            "Royalty address must match NFT creator"
        );
        require!(
            BigUint::from(royalty_percent) == nft_data.royalties,
            "Royalties must match NFT metadata"
        );

        let listing_id = self.last_listing_id().get() + 1;
        self.last_listing_id().set(listing_id);

        let listing = Listing {
            listing_id,
            seller: caller.clone(),
            nft_token: payment.token_identifier.clone(),
            nft_nonce: payment.token_nonce,
            price: price.clone(),
            royalty_address,
            royalty_percent,
            #[allow(deprecated)]
            timestamp: self.blockchain().get_block_timestamp(),
            is_active: true,
        };

        self.listings(listing_id).set(listing);
        self.active_listings().insert(listing_id);
        self.seller_listings(&caller).insert(listing_id);

        self.listing_created_event(
            listing_id,
            &caller,
            &payment.token_identifier,
            payment.token_nonce,
            &price,
        );
    }

    // ─── Buy NFT ─────────────────────────────────────────────────────────────

    /// Buyer sends exact TCL amount; receives NFT.
    /// Fees: platform fee + royalties deducted from payment; rest goes to seller.
    #[payable("*")]
    #[endpoint(buyNFT)]
    fn buy_nft(&self, listing_id: u64) {
        require!(!self.paused().get(), "Marketplace is paused");

        let caller = self.blockchain().get_caller();
        let payment = self.call_value().single_esdt();

        let tcl_token = TokenIdentifier::from(TCL_TOKEN_ID);
        require!(
            payment.token_identifier == tcl_token,
            "Must pay with TCL-fe459d"
        );

        require!(!self.listings(listing_id).is_empty(), "Listing not found");
        let listing = self.listings(listing_id).get();

        require!(listing.is_active, "Listing is not active");
        require!(caller != listing.seller, "Cannot buy your own listing");
        require!(payment.amount == listing.price, "Incorrect TCL amount");

        // Deactivate listing before transfers (reentrancy guard)
        let mut updated = listing.clone();
        updated.is_active = false;
        self.listings(listing_id).set(updated.clone());
        self.active_listings().swap_remove(&listing_id);
        self.seller_listings(&listing.seller).swap_remove(&listing_id);

        // Calculate splits
        let fee_percent = self.fee_percent().get();
        let platform_fee = &listing.price * fee_percent / 100u64;
        let royalty_amount = if listing.royalty_percent > 0 {
            &listing.price * listing.royalty_percent / ROYALTY_DENOMINATOR
        } else {
            BigUint::zero()
        };
        let seller_amount = &listing.price - &platform_fee - &royalty_amount;

        // Send NFT to buyer
        self.send().direct_esdt(
            &caller,
            &listing.nft_token,
            listing.nft_nonce,
            &BigUint::from(1u32),
        );

        // Send TCL to seller
        self.send().direct_esdt(
            &listing.seller,
            &tcl_token,
            0u64,
            &seller_amount,
        );

        // Send royalties to creator (if any)
        if royalty_amount > BigUint::zero() {
            self.send().direct_esdt(
                &listing.royalty_address,
                &tcl_token,
                0u64,
                &royalty_amount,
            );
        }

        // Send platform fee directly to owner
        if platform_fee > BigUint::zero() {
            let owner = self.blockchain().get_owner_address();
            self.send().direct_esdt(
                &owner,
                &tcl_token,
                0u64,
                &platform_fee,
            );
        }

        self.listing_sold_event(
            listing_id,
            &listing.seller,
            &caller,
            &listing.nft_token,
            listing.nft_nonce,
            &listing.price,
            &platform_fee,
            &royalty_amount,
        );
    }

    // ─── Cancel Listing ───────────────────────────────────────────────────────

    /// Seller (or contract owner) cancels a listing; NFT returned to seller.
    #[endpoint(cancelListing)]
    fn cancel_listing(&self, listing_id: u64) {
        let caller = self.blockchain().get_caller();
        let owner = self.blockchain().get_owner_address();

        require!(!self.listings(listing_id).is_empty(), "Listing not found");
        let listing = self.listings(listing_id).get();

        require!(listing.is_active, "Listing is not active");
        require!(
            caller == listing.seller || caller == owner,
            "Not authorized to cancel"
        );

        let mut updated = listing.clone();
        updated.is_active = false;
        self.listings(listing_id).set(updated);
        self.active_listings().swap_remove(&listing_id);
        self.seller_listings(&listing.seller).swap_remove(&listing_id);

        // Return NFT to seller
        self.send().direct_esdt(
            &listing.seller,
            &listing.nft_token,
            listing.nft_nonce,
            &BigUint::from(1u32),
        );

        self.listing_cancelled_event(listing_id, &listing.seller, &caller);
    }

    // ─── Update Price ─────────────────────────────────────────────────────────

    #[endpoint(updatePrice)]
    fn update_price(&self, listing_id: u64, new_price: BigUint) {
        require!(!self.paused().get(), "Marketplace is paused");
        let caller = self.blockchain().get_caller();

        require!(!self.listings(listing_id).is_empty(), "Listing not found");
        let mut listing = self.listings(listing_id).get();

        require!(listing.is_active, "Listing is not active");
        require!(caller == listing.seller, "Only seller can update price");
        require!(new_price > BigUint::zero(), "Price must be > 0");

        listing.price = new_price.clone();
        self.listings(listing_id).set(listing);

        self.price_updated_event(listing_id, &caller, &new_price);
    }

    // ─── Owner: Creator Whitelist ─────────────────────────────────────────────

    /// Add a trusted NFT creator — all their collections become listable automatically.
    #[only_owner]
    #[endpoint(addAllowedCreator)]
    fn add_allowed_creator(&self, creator: ManagedAddress) {
        self.allowed_creators().insert(creator);
    }

    #[only_owner]
    #[endpoint(removeAllowedCreator)]
    fn remove_allowed_creator(&self, creator: ManagedAddress) {
        self.allowed_creators().swap_remove(&creator);
    }

    // ─── Owner: Pause / Unpause ───────────────────────────────────────────────

    #[only_owner]
    #[endpoint(pause)]
    fn pause(&self) {
        require!(!self.paused().get(), "Already paused");
        self.paused().set(true);
        self.pause_toggled_event(true);
    }

    #[only_owner]
    #[endpoint(unpause)]
    fn unpause(&self) {
        require!(self.paused().get(), "Not paused");
        self.paused().set(false);
        self.pause_toggled_event(false);
    }

    // ─── Owner: Fee Config ────────────────────────────────────────────────────

    #[only_owner]
    #[endpoint(setFeePercent)]
    fn set_fee_percent(&self, fee: u64) {
        require!(fee <= MAX_FEE_PERCENT, "Fee cannot exceed 10%");
        self.fee_percent().set(fee);
    }

    /// Recovers any tokens accidentally sent directly to the contract address.
    /// NOTE: platform fees are forwarded to the owner per-sale, not accumulated here.
    #[only_owner]
    #[endpoint(recoverTokens)]
    fn recover_tokens(&self, token_id: TokenIdentifier, amount: BigUint) {
        require!(amount > BigUint::zero(), "Amount must be > 0");
        let owner = self.blockchain().get_owner_address();
        let egld_or_esdt = EgldOrEsdtTokenIdentifier::esdt(token_id.clone());
        let balance = self.blockchain().get_sc_balance(&egld_or_esdt, 0u64);
        require!(balance >= amount, "Insufficient contract balance");
        self.send().direct_esdt(&owner, &token_id, 0u64, &amount);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    #[view(getActiveListings)]
    fn get_active_listings(&self) -> MultiValueEncoded<u64> {
        let mut result = MultiValueEncoded::new();
        for id in self.active_listings().iter() {
            result.push(id);
        }
        result
    }

    #[view(getListing)]
    fn get_listing(&self, listing_id: u64) -> Listing<Self::Api> {
        require!(!self.listings(listing_id).is_empty(), "Listing not found");
        self.listings(listing_id).get()
    }

    #[view(getListingCount)]
    fn get_listing_count(&self) -> u64 {
        self.last_listing_id().get()
    }

    #[view(getFeePercent)]
    fn get_fee_percent(&self) -> u64 {
        self.fee_percent().get()
    }

    #[view(getTclToken)]
    fn get_tcl_token(&self) -> ManagedBuffer {
        ManagedBuffer::from(TCL_TOKEN_ID)
    }

    #[view(getSellerListings)]
    fn get_seller_listings(&self, seller: ManagedAddress) -> MultiValueEncoded<u64> {
        let mut result = MultiValueEncoded::new();
        for id in self.seller_listings(&seller).iter() {
            result.push(id);
        }
        result
    }

    #[view(isPaused)]
    fn is_paused(&self) -> bool {
        self.paused().get()
    }

    #[view(isCreatorAllowed)]
    fn is_creator_allowed(&self, creator: ManagedAddress) -> bool {
        self.allowed_creators().contains(&creator)
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    #[event("listingCreated")]
    fn listing_created_event(
        &self,
        #[indexed] listing_id: u64,
        #[indexed] seller: &ManagedAddress,
        #[indexed] nft_token: &TokenIdentifier,
        #[indexed] nft_nonce: u64,
        #[indexed] price: &BigUint,
    );

    #[event("listingSold")]
    fn listing_sold_event(
        &self,
        #[indexed] listing_id: u64,
        #[indexed] seller: &ManagedAddress,
        #[indexed] buyer: &ManagedAddress,
        #[indexed] nft_token: &TokenIdentifier,
        #[indexed] nft_nonce: u64,
        #[indexed] price: &BigUint,
        #[indexed] platform_fee: &BigUint,
        #[indexed] royalty_amount: &BigUint,
    );

    #[event("listingCancelled")]
    fn listing_cancelled_event(
        &self,
        #[indexed] listing_id: u64,
        #[indexed] seller: &ManagedAddress,
        #[indexed] cancelled_by: &ManagedAddress,
    );

    #[event("priceUpdated")]
    fn price_updated_event(
        &self,
        #[indexed] listing_id: u64,
        #[indexed] seller: &ManagedAddress,
        #[indexed] new_price: &BigUint,
    );

    #[event("pauseToggled")]
    fn pause_toggled_event(&self, #[indexed] is_paused: bool);

    // ─── Storage ──────────────────────────────────────────────────────────────

    #[storage_mapper("listings")]
    fn listings(&self, listing_id: u64) -> SingleValueMapper<Listing<Self::Api>>;

    #[storage_mapper("activeListings")]
    fn active_listings(&self) -> UnorderedSetMapper<u64>;

    #[storage_mapper("sellerListings")]
    fn seller_listings(&self, seller: &ManagedAddress) -> UnorderedSetMapper<u64>;

    #[storage_mapper("lastListingId")]
    fn last_listing_id(&self) -> SingleValueMapper<u64>;

    #[storage_mapper("feePercent")]
    fn fee_percent(&self) -> SingleValueMapper<u64>;

    #[storage_mapper("paused")]
    fn paused(&self) -> SingleValueMapper<bool>;

    #[storage_mapper("allowedCreators")]
    fn allowed_creators(&self) -> UnorderedSetMapper<ManagedAddress>;
}
