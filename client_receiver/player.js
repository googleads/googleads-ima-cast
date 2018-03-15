/**
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

/**
 * Creates new player for video and ad playback.
 * @param {cast.receiver.MediaManager} mediaElement The video element.
 */
var Player = function(mediaElement) {
  var namespace = 'urn:x-cast:com.google.ads.ima.cast';
  this.mediaElement_ = mediaElement;
  this.mediaManager_ = new cast.receiver.MediaManager(this.mediaElement_);
  this.castReceiverManager_ = cast.receiver.CastReceiverManager.getInstance();
  this.imaMessageBus_ = this.castReceiverManager_.getCastMessageBus(namespace);
  this.castReceiverManager_.start();

  this.originalOnLoad_ = this.mediaManager_.onLoad.bind(this.mediaManager_);
  this.originalOnEnded_ = this.mediaManager_.onEnded.bind(this.mediaManager_);
  this.originalOnSeek_ = this.mediaManager_.onSeek.bind(this.mediaManager_);

  this.setupCallbacks_();
};

/**
 * Attaches necessary callbacks.
 * @private
 */
Player.prototype.setupCallbacks_ = function() {
  var self = this;

  // Chromecast device is disconnected from sender app.
  this.castReceiverManager_.onSenderDisconnected = function() {
    window.close();
  };

  // Receives messages from sender app. The message is a comma separated string
  // where the first substring indicates the function to be called and the
  // following substrings are the parameters to be passed to the function.
  this.imaMessageBus_.onMessage = function(event) {
    console.log(event.data);
    var message = event.data.split(',');
    var method = message[0];
    switch (method) {
      case 'requestAd':
        var adTag = message[1];
        var currentTime = parseFloat(message[2]);
        self.requestAd_(adTag, currentTime);
        break;
      case 'seek':
        var time = parseFloat(message[1]);
        self.seek_(time);
        break;
      default:
        self.broadcast_('Message not recognized');
        break;
    }
  };

  // Initializes IMA SDK when Media Manager is loaded.
  this.mediaManager_.onLoad = function(event) {
    self.originalOnLoadEvent_ = event;
    self.initIMA_();
    self.originalOnLoad_(self.originalOnLoadEvent_);
  };
};

/**
 * Sends messages to all connected sender apps.
 * @param {!string} message Message to be sent to senders.
 * @private
 */
Player.prototype.broadcast_ = function(message) {
  this.imaMessageBus_.broadcast(message);
};

/**
 * Creates new AdsLoader and adds listeners.
 * @private
 */
Player.prototype.initIMA_ = function() {
  this.currentContentTime_ = -1;
  var adDisplayContainer = new google.ima.AdDisplayContainer(
      document.getElementById('adContainer'), this.mediaElement_);
  adDisplayContainer.initialize();
  this.adsLoader_ = new google.ima.AdsLoader(adDisplayContainer);
  this.adsLoader_.getSettings().setPlayerType('cast/client-side');
  this.adsLoader_.addEventListener(
      google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
      this.onAdsManagerLoaded_.bind(this), false);
  this.adsLoader_.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR,
      this.onAdError_.bind(this), false);
  this.adsLoader_.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED,
      this.onAllAdsCompleted_.bind(this), false);
};

/**
 * Sends AdsManager playAdsAfterTime if starting in the middle of content and
 * starts AdsManager.
 * @param {ima.AdsManagerLoadedEvent} adsManagerLoadedEvent The loaded event.
 * @private
 */
Player.prototype.onAdsManagerLoaded_ = function(adsManagerLoadedEvent) {
  var adsRenderingSettings = new google.ima.AdsRenderingSettings();
  adsRenderingSettings.playAdsAfterTime = this.currentContentTime_;

  // Get the ads manager.
  this.adsManager_ = adsManagerLoadedEvent.getAdsManager(
    this.mediaElement_, adsRenderingSettings);

  // Add listeners to the required events.
  this.adsManager_.addEventListener(
      google.ima.AdErrorEvent.Type.AD_ERROR,
      this.onAdError_.bind(this));
  this.adsManager_.addEventListener(
      google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED,
      this.onContentPauseRequested_.bind(this));
  this.adsManager_.addEventListener(
      google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED,
      this.onContentResumeRequested_.bind(this));

  try {
    this.adsManager_.init(this.mediaElement_.width, this.mediaElement_.height,
        google.ima.ViewMode.FULLSCREEN);
    this.adsManager_.start();
  } catch (adError) {
    // An error may be thrown if there was a problem with the VAST response.
    this.broadcast_('Ads Manager Error: ' + adError.getMessage());
  }
};

/**
 * Handles errors from AdsLoader and AdsManager.
 * @param {ima.AdErrorEvent} adErrorEvent error
 * @private
 */
Player.prototype.onAdError_ = function(adErrorEvent) {
  this.broadcast_('Ad Error: ' + adErrorEvent.getError().toString());
  // Handle the error logging.
  if (this.adsManager_) {
    this.adsManager_.destroy();
  }
  this.mediaElement_.play();
};

/**
 * When content is paused by AdsManager to start playing an ad.
 * @private
 */
Player.prototype.onContentPauseRequested_ = function() {
  this.currentContentTime_ = this.mediaElement_.currentTime;
  this.broadcast_('onContentPauseRequested,' + this.currentContentTime_);
  this.mediaManager_.onEnded = function(event) {};
  this.mediaManager_.onSeek = function(event) {};
};

/**
 * When an ad finishes playing and AdsManager resumes content.
 * @private
 */
Player.prototype.onContentResumeRequested_ = function() {
  this.broadcast_('onContentResumeRequested');
  this.mediaManager_.onEnded = this.originalOnEnded_.bind(this.mediaManager_);
  this.mediaManager_.onSeek = this.originalOnSeek_.bind(this.mediaManager_);

  this.originalOnLoad_(this.originalOnLoadEvent_);
  this.seek_(this.currentContentTime_);
};

/**
 * Destroys AdsManager when all requested ads have finished playing.
 * @private
 */
Player.prototype.onAllAdsCompleted_ = function() {
  if (this.adsManager_) {
    this.adsManager_.destroy();
  }
};

/**
 * Sets time video should seek to when content resumes and requests ad tag.
 * @param {!string} adTag ad tag to be requested.
 * @param {!float} currentTime time of content video we should resume from.
 * @private
 */
Player.prototype.requestAd_ = function(adTag, currentTime) {
  if (currentTime != 0) {
    this.currentContentTime_ = currentTime;
  }
  var adsRequest = new google.ima.AdsRequest();
  adsRequest.adTagUrl = adTag;
  adsRequest.linearAdSlotWidth = this.mediaElement_.width;
  adsRequest.linearAdSlotHeight = this.mediaElement_.height;
  adsRequest.nonLinearAdSlotWidth = this.mediaElement_.width;
  adsRequest.nonLinearAdSlotHeight = this.mediaElement_.height / 3;
  this.adsLoader_.requestAds(adsRequest);
};

/**
 * Seeks content video.
 * @param {!float} time time to seek to.
 * @private
 */
Player.prototype.seek_ = function(time) {
  this.currentContentTime_ = time;
  this.mediaElement_.currentTime = time;
  this.mediaElement_.play();
};
